import { TelloClient } from '../main';

const tello = new TelloClient();

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

(async (): Promise<void> => {
  try {
    await tello.connect();
    console.log('Connected successfully.');

    await delay(1000);
    console.log('Battery level:', await tello.queryBattery(), '%');

    console.log('Taking off...');
    await tello.takeoff();

    console.log('Ascending 20 cm...');
    await tello.up(20);

    console.log('Rotating 180° clockwise...');
    await tello.cw(180);

    console.log('Rotating 180° counterclockwise...');
    await tello.ccw(180);

    console.log('Descending 20 cm...');
    await tello.down(20);

    console.log('Landing...');
    await tello.land();

    tello.disconnect();
    console.log('Drone disconnected.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    tello.disconnect();
    process.exit(1);
  }
})();
