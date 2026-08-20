import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('config', () => {
  it('config.yaml 없으면 기본값', () => {
    expect(loadConfig(tmp())).toEqual(DEFAULT_CONFIG);
  });

  it('부분 설정은 기본값과 병합', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/config.yaml'), 'remote_control: false\n');
    const c = loadConfig(root);
    expect(c.remote_control).toBe(false);
    expect(c.profile).toBe('generic');
  });
});
