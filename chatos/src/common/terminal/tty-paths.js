export function getDefaultTtyPaths(platform = process.platform) {
  if (platform === 'win32') {
    return { inputPath: '\\\\.\\CONIN$', outputPath: '\\\\.\\CONOUT$' };
  }
  return { inputPath: '/dev/tty', outputPath: '/dev/tty' };
}
