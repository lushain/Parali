import {describe,it,expect} from 'vitest';
import {voiceLevel} from '../src/voice-level';
describe('microphone activity',()=>{
  it('stays still for silence and low background noise',()=>{
    expect(voiceLevel(new Float32Array(2048))).toBe(0);
    expect(voiceLevel(new Float32Array(2048).fill(.004))).toBe(0);
    expect(voiceLevel(new Float32Array())).toBe(0);
  });
  it('responds to actual loudness and bounds clipping',()=>{
    expect(voiceLevel(new Float32Array(2048).fill(.05))).toBeGreaterThan(voiceLevel(new Float32Array(2048).fill(.02)));
    expect(voiceLevel(new Float32Array(2048).fill(-1))).toBe(1);
  });
});
