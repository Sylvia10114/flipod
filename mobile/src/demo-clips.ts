import type { Clip } from './types';

export const demoClips: Clip[] = [
  {
    title: '她用鼻子诊断了一种病',
    source: { podcast: 'TED Talks Daily' },
    tag: 'science',
    lines: [
      {
        en: 'A woman discovered she could smell Parkinson’s before doctors could diagnose it.',
        zh: '一位女性发现，自己能在医生确诊前闻出帕金森病。',
        start: 0,
        end: 6,
      },
    ],
  },
  {
    title: 'AI写内容为什么总像废话？',
    source: { podcast: 'Business Storytelling' },
    tag: 'tech',
    lines: [
      {
        en: 'The problem is not that AI cannot write, but that it often sounds like nobody in particular.',
        zh: '问题不在于 AI 不会写，而在于它常常听起来不像任何一个真实的人。',
        start: 0,
        end: 7,
      },
    ],
  },
  {
    title: '11岁那年的嫉妒',
    source: { podcast: 'This American Life' },
    tag: 'story',
    lines: [
      {
        en: 'At eleven, jealousy felt less like an emotion and more like a place I was trapped in.',
        zh: '十一岁时，嫉妒不像一种情绪，更像一个把我困住的地方。',
        start: 0,
        end: 7,
      },
    ],
  },
];
