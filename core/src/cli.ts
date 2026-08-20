export function main(argv: string[]): void {
  if (argv[0] === '--version') {
    console.log('king-wjang-harness core v0');
    return;
  }
  console.error(`unknown command: ${argv.join(' ') || '(none)'}`);
  process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2));
