import { describe, expect, it } from 'vitest';
import config from '../../app.config';
const { enableIndependentPointers } = require('../../plugins/withTalkToMeMultiTouch');

describe('Android native multi-touch setup', () => {
  it('enables independent pointer dispatch before the React surface starts', () => {
    expect(config.plugins).toContain('./plugins/withTalkToMeMultiTouch');
    for (const language of ['kt', 'java']) {
      const source = `override fun onCreate() {\n    super.onCreate()${language === 'java' ? ';' : ''}\n    loadReactNative(this)\n}`;
      const result = enableIndependentPointers(source, language);
      expect(result.indexOf('dispatchPointerEvents = true')).toBeLessThan(result.indexOf('loadReactNative(this)'));
      expect(enableIndependentPointers(result, language)).toBe(result);
    }
  });
  it('rejects a changed startup template rather than silently shipping single-touch behavior', () => {
    expect(() => enableIndependentPointers('class MainApplication {}', 'kt')).toThrow('Unexpected MainApplication startup');
  });
});
