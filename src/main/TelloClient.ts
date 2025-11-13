import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { CommandResponse, TelloState } from './types';
import { parseState } from './utils/parseState';
import { ValidationError } from './errors';
import ffmpegPath from 'ffmpeg-static';
import { EventEmitter } from 'events';
import dgram from 'dgram';

export class TelloClient extends EventEmitter {
  private commandSocket: dgram.Socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  private stateSocket: dgram.Socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  private telloIp = '192.168.10.1';
  private videoPort = 11111;
  private statePort = 8890;
  private cmdPort = 8889;

  private videoConnected = false;
  private ffmpegProcess?: ChildProcessWithoutNullStreams;
  private ffmpegEnabled = false;
  private isConnected = false;

  private state: TelloState | null = null;

  #commandQueue: Array<{
    command: string;
    timeout?: number;
    resolve: (r: CommandResponse) => void;
    reject: (e: any) => void;
  }> = [];


  #isExecuting = false;
  #isEmergency = false;

  constructor() {
    super();
    this.stateSocket.on('message', (msg) => {
      this.state = parseState(msg.toString());
      this.emit('state', this.state);
    });

    this.commandSocket.on('message', (msg) => {
      if (!msg) return;
      const str = msg.toString('utf8').trim();

      if (!/^[\x20-\x7E]+$/.test(str)) {
        console.warn('Invalid packet received:', msg);
        return;
      }

      this.emit('response', str);
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        try {
          this.stateSocket.bind(this.statePort, () => resolve());
        } catch (err) {
          reject(err);
        }
      }),
      new Promise<void>((resolve, reject) => {
        try {
          this.commandSocket.bind(this.cmdPort, () => resolve());
        } catch (err) {
          reject(err);
        }
      }),
    ]);


    this.isConnected = true;

    const res = await this.#enqueue('command', { priority: true });
    if (!res.success)
      throw new Error(`An error ocurred when entering in SDK mode: ${res.message}`);
  }


  public disconnect(): void {
    if (!this.isConnected) return;

    this.#stopFfmpeg();

    this.commandSocket.removeAllListeners();
    this.stateSocket.removeAllListeners();

    this.commandSocket.unref();
    this.stateSocket.unref();

    this.commandSocket.close();
    this.stateSocket.close();

    this.isConnected = false;
    this.#commandQueue = [];
    this.#isExecuting = false;
    this.#isEmergency = false;
  }

  async #enqueue(
    cmd: string,
    options?: { priority?: boolean; timeout?: number },
  ): Promise<CommandResponse> {
    const { priority = false, timeout } = options || {};

    return new Promise<CommandResponse>((resolve, reject) => {
      const task = { command: cmd, timeout, resolve, reject };

      if (priority) {
        this.#commandQueue = [task, ...this.#commandQueue];
      } else {
        this.#commandQueue.push(task);
      }

      this.#next();
    });
  }

  async #next(): Promise<void> {
    if (this.#isExecuting || this.#commandQueue.length === 0 || this.#isEmergency) return;

    this.#isExecuting = true;
    const { command, timeout, resolve, reject } = this.#commandQueue.shift()!;

    try {
      const result = await this.#sendCommand(command, timeout);
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.#isExecuting = false;
      if (!this.#isEmergency) this.#next();
    }
  }

  #sendCommand(
    cmd: string,
    timeout = 5000,
    maxRetries = 3,
  ): Promise<CommandResponse> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Tello is not connected. Call connect() first.'));
    }

    return new Promise<CommandResponse>(async (resolve, reject) => {
      const attempts = Array.from({ length: maxRetries });

      for await (const [i] of attempts.entries()) {
        const attempt = i + 1;
        const message = Buffer.from(cmd);
        const attemptLabel = `${cmd} (attempt ${attempt}/${maxRetries})`;

        try {
          const response = await new Promise<CommandResponse>((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`Timeout waiting for response to "${attemptLabel}"`));
            }, timeout);

            const handler = (msg: Buffer): void => {
              const str = msg.toString('utf8').trim();
              clearTimeout(timer);
              this.commandSocket!.off('message', handler);
              const isOk = str.toLowerCase() !== 'error' && str.trim().length > 0;
              res({ success: isOk, message: str });
            };

            this.commandSocket!.once('message', handler);

            this.commandSocket!.send(message, this.cmdPort, this.telloIp, (err) => {
              if (err) {
                clearTimeout(timer);
                this.commandSocket!.off('message', handler);
                rej(err);
              }
            });
          });

          if (response.success) {
            if (attempt > 1) console.log(`"${cmd}" succeeded after ${attempt} attempts`);
            return resolve(response);
          }

          console.warn(`Command "${cmd}" returned "${response.message}"`);
        } catch (err: any) {
          console.warn(`Command "${cmd}" timed out (${attempt}/${maxRetries}): ${err.message}`);
          if (attempt >= maxRetries) return reject(err);
        }


        await new Promise((r) => setTimeout(r, 400));
      }

      reject(new Error(`Failed to send command "${cmd}" after ${maxRetries} attempts`));
    });
  }

  public async setWifi(ssid: string, password: string): Promise<CommandResponse> {
    return this.#enqueue(`wifi ${ssid} ${password}`, { timeout: 10000 });
  }

  public async takeoff(): Promise<CommandResponse> {
    return this.#enqueue('takeoff', { priority: true, timeout: 12000 });
  }

  public async land(): Promise<CommandResponse> {
    return this.#enqueue('land', { timeout: 12000 });
  }

  public async emergency(): Promise<CommandResponse> {
    this.#isEmergency = true;
    this.#commandQueue = [];

    try {
      const result = await this.#sendCommand('emergency');
      this.emit('emergency', result);
      return result;
    } finally {
      this.#commandQueue = [];
      this.#isExecuting = false;
      this.#isEmergency = false;
      this.#stopFfmpeg();
    }
  }

  public async up(distance: number): Promise<CommandResponse> {
    this.#validateRange('up', distance, 20, 500);
    return this.#enqueue(`up ${distance}`);
  }

  public async down(distance: number): Promise<CommandResponse> {
    this.#validateRange('down', distance, 20, 500);
    return this.#enqueue(`down ${distance}`);
  }

  public async left(distance: number): Promise<CommandResponse> {
    this.#validateRange('left', distance, 20, 500);
    return this.#enqueue(`left ${distance}`);
  }

  public async right(distance: number): Promise<CommandResponse> {
    this.#validateRange('right', distance, 20, 500);
    return this.#enqueue(`right ${distance}`);
  }

  public async forward(distance: number): Promise<CommandResponse> {
    this.#validateRange('forward', distance, 20, 500);
    return this.#enqueue(`forward ${distance}`);
  }

  public async back(distance: number): Promise<CommandResponse> {
    this.#validateRange('back', distance, 20, 500);
    return this.#enqueue(`back ${distance}`);
  }

  public async cw(degrees: number): Promise<CommandResponse> {
    this.#validateRange('cw', degrees, 1, 3600);
    return this.#enqueue(`cw ${degrees}`);
  }

  public async ccw(degrees: number): Promise<CommandResponse> {
    this.#validateRange('ccw', degrees, 1, 3600);
    return this.#enqueue(`ccw ${degrees}`);
  }

  public getBattery(): number {
    return this.state?.bat || -1;
  }

  public async queryBattery(): Promise<number> {
    const res = await this.#enqueue('battery?');
    const level = parseInt(res.message, 10);
    if (isNaN(level)) throw new Error(`Invalid battery level: ${res.message}`);
    return level;
  }

  public getTemperature(): number {
    return (((this.state?.temph || -1) + (this.state?.templ || -1)) / 2);
  }

  public async queryTemperature(): Promise<number> {
    const res = await this.#enqueue('temp?');
    const temp = parseInt(res.message, 10);
    if (isNaN(temp)) throw new Error(`Invalid temperature: ${res.message}`);
    return temp;
  }

  public async startVideo(): Promise<CommandResponse> {
    if (this.videoConnected) {
      return { success: true, message: 'Video already started.' };
    }
    const res = await this.#enqueue('streamon');
    this.emit('video-start', res);
    this.videoConnected = true;
    return res;
  }

  public async stopVideo(): Promise<CommandResponse> {
    if (!this.videoConnected) {
      return { success: true, message: 'Video already stopped.' };
    }
    const res = await this.#enqueue('streamoff');
    this.emit('video-stop', res);
    this.#stopFfmpeg();
    return res;
  }

  public startFfmpegDecoder(): void {
    if (this.ffmpegEnabled) return;
    if (!this.videoConnected) this.startVideo();
    if (!ffmpegPath) throw new Error('ffmpeg-static binary not found — unable to start decoder.');

    this.ffmpegEnabled = true;

    const args = [
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-probesize', '5000000',
      '-analyzeduration', '10000000',
      '-threads', '1',
      '-i', `udp://0.0.0.0:${this.videoPort}?overrun_nonfatal=1&fifo_size=50000000`,
      '-f', 'image2pipe',
      '-pix_fmt', 'yuvj420p',
      '-vcodec', 'mjpeg',
      '-',
    ];

    this.ffmpegProcess = spawn(ffmpegPath, args);

    let buffer = Buffer.alloc(0);

    this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      let start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      let end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

      while (start !== -1 && end !== -1) {
        const frame = buffer.subarray(start, end + 2);
        this.emit('frame', frame);
        buffer = buffer.subarray(end + 2);
        start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
        end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      }

      if (buffer.length > 5_000_000) buffer = Buffer.alloc(0);
    });

    this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('frame=')) process.stdout.write(msg.split('\r').pop()?.toString() || '');
    });

    this.ffmpegProcess.on('exit', () => {
      this.ffmpegEnabled = false;
      this.emit('frame-end');
    });
  }

  public async captureFrame(timeout = 3000): Promise<Buffer> {
    if (!this.videoConnected) await this.startVideo();
    if (this.ffmpegEnabled) {
      return this.#onceFrame(timeout);
    }

    if (!ffmpegPath) throw new Error('ffmpeg-static binary not found.');

    return new Promise<Buffer>((resolve, reject) => {
      const ff = spawn(ffmpegPath!, [
        '-y',
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-i', `udp://0.0.0.0:${this.videoPort}?overrun_nonfatal=1&fifo_size=50000000`,
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-',
      ]);

      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        try { ff.kill('SIGINT'); } catch { }
        reject(new Error('Timeout while waiting for frame.'));
      }, timeout);

      ff.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
        const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

        if (start !== -1 && end !== -1) {
          const frame = buffer.subarray(start, end + 2);
          clearTimeout(timer);
          try { ff.kill('SIGINT'); } catch { }
          resolve(frame);
        }

        if (buffer.length > 5_000_000) buffer = Buffer.alloc(0);
      });

      ff.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      ff.on('exit', (code) => {
        if (code !== 0 && buffer.length === 0) {
          reject(new Error(`FFmpeg exited with code ${code} before frame was captured.`));
        }
      });
    });
  }

  public isFlying(): boolean {
    return ((this.state?.h ?? 0) > 0);
  }

  public getFlyingTime(): number {
    return this.state?.time ?? 0;
  }

  public getCurrentState(): TelloState | null {
    return this.state;
  }

  public async *streamFrames(): AsyncGenerator<Buffer> {
    const queue: Buffer[] = [];
    const handler = (frame: Buffer): number => queue.push(frame);

    this.on('frame', handler);
    try {
      while (this.ffmpegEnabled || queue.length > 0) {
        if (queue.length > 0) yield queue.shift()!;
        // eslint-disable-next-line no-await-in-loop
        else await new Promise((res) => setTimeout(res, 20));
      }
    } finally {
      this.off('frame', handler);
    }
  }

  #onceFrame(timeout = 3000): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const onFrame = (frame: Buffer): void => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        clear();
        resolve(frame);
      };
      const onEnd = (): void => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        clear();
        reject(new Error('FFmpeg ended before frame arrived.'));
      };
      const onError = (err: any): void => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        clear();
        reject(err);
      };

      const timer = setTimeout(() => {
        this.off('frame', onFrame);
        this.off('frame-end', onEnd);
        reject(new Error('Timeout waiting for frame.'));
      }, timeout);

      const clear = (): void => {
        clearTimeout(timer);
        this.off('frame', onFrame);
        this.off('frame-end', onEnd);
        this.off('video-error', onError);
      };

      this.once('frame', onFrame);
      this.once('frame-end', onEnd);
      this.once('video-error', onError);
    });
  }


  #stopFfmpeg(): void {
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
      this.ffmpegProcess.kill('SIGINT');
      this.ffmpegProcess = undefined;
      this.ffmpegEnabled = false;
    }
  }

  #validateRange(command: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value))
      throw new ValidationError(`The parameter ${command} must be an integer.`);
    if (value < min || value > max)
      throw new ValidationError(
        `The value of ${command} must be between ${min} and ${max}. (Current: ${value})`,
      );
  }
}
