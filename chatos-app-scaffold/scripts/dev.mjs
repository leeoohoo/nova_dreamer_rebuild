import { runBuild } from './build.mjs';

const main = async () => {
  await runBuild();
  console.log('Dev mode: rebuild complete. Add your own watcher if needed.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
