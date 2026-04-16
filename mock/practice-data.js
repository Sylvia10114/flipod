/**
 * Mock data for Listening Practice module (demo only).
 * Provides: MOCK_VOCAB, MOCK_PRACTICES, initMockVocab()
 */
(function () {
  'use strict';

  const MOCK_VOCAB = [
    // business
    { word: "benchmark", cefr: "B2", definition_zh: "基准；参照标准", tag: "business", added: "2026-04-15" },
    { word: "recession", cefr: "B2", definition_zh: "经济衰退", tag: "business", added: "2026-04-15" },
    { word: "inflation", cefr: "B2", definition_zh: "通货膨胀", tag: "business", added: "2026-04-14" },
    { word: "debt", cefr: "B2", definition_zh: "债务，欠款", tag: "business", added: "2026-04-14" },
    { word: "revenue", cefr: "B2", definition_zh: "收入，营收", tag: "business", added: "2026-04-13" },
    { word: "portfolio", cefr: "C1", definition_zh: "投资组合；作品集", tag: "business", added: "2026-04-13" },
    { word: "dividend", cefr: "C1", definition_zh: "股息，红利", tag: "business", added: "2026-04-12" },
    // psychology
    { word: "cognitive", cefr: "B2", definition_zh: "认知的", tag: "psychology", added: "2026-04-15" },
    { word: "bias", cefr: "B2", definition_zh: "偏见，偏差", tag: "psychology", added: "2026-04-14" },
    { word: "empathy", cefr: "B2", definition_zh: "共情，同理心", tag: "psychology", added: "2026-04-14" },
    { word: "resilience", cefr: "C1", definition_zh: "韧性，恢复力", tag: "psychology", added: "2026-04-13" },
    { word: "stimulus", cefr: "C1", definition_zh: "刺激；激励", tag: "psychology", added: "2026-04-12" },
    // science
    { word: "hypothesis", cefr: "B2", definition_zh: "假说，假设", tag: "science", added: "2026-04-15" },
    { word: "molecule", cefr: "B2", definition_zh: "分子", tag: "science", added: "2026-04-14" },
    { word: "catalyst", cefr: "C1", definition_zh: "催化剂；促进因素", tag: "science", added: "2026-04-13" },
    { word: "synthesize", cefr: "C1", definition_zh: "合成；综合", tag: "science", added: "2026-04-12" },
    // story
    { word: "narrative", cefr: "B2", definition_zh: "叙事，叙述", tag: "story", added: "2026-04-15" },
    { word: "protagonist", cefr: "C1", definition_zh: "主角，主人公", tag: "story", added: "2026-04-14" },
    { word: "dilemma", cefr: "B2", definition_zh: "困境，两难", tag: "story", added: "2026-04-13" },
    { word: "metaphor", cefr: "C1", definition_zh: "隐喻，比喻", tag: "story", added: "2026-04-12" },
  ];

  const MOCK_PRACTICES = [
    {
      id: "practice_b1_business_001",
      title: "The Hidden Cost of Low Interest Rates",
      tag: "business",
      cefr: "B1",
      target_words: ["benchmark", "recession", "inflation"],
      text: "When central banks set their benchmark interest rate very low, borrowing money becomes cheap. Many people think this is always good news. But economists warn that keeping rates low for too long can lead to inflation. Prices start rising faster than wages, and ordinary people find it harder to afford basic goods. During the last recession, governments around the world cut rates to help the economy recover. While this prevented a deeper crisis, it also created new problems. Asset prices climbed rapidly, and the gap between rich and poor grew wider. The challenge for policymakers is finding the right balance \u2014 low enough to encourage growth, but not so low that it fuels instability.",
      lines: [
        { en: "When central banks set their benchmark interest rate very low, borrowing money becomes cheap.", zh: "\u5f53\u592e\u884c\u5c06\u57fa\u51c6\u5229\u7387\u8bbe\u5b9a\u5f97\u5f88\u4f4e\u65f6\uff0c\u501f\u94b1\u5c31\u53d8\u5f97\u4fbf\u5b9c\u4e86\u3002", target_words: ["benchmark"], start: 0, end: 5.2 },
        { en: "Many people think this is always good news.", zh: "\u5f88\u591a\u4eba\u8ba4\u4e3a\u8fd9\u603b\u662f\u597d\u6d88\u606f\u3002", target_words: [], start: 5.2, end: 7.8 },
        { en: "But economists warn that keeping rates low for too long can lead to inflation.", zh: "\u4f46\u7ecf\u6d4e\u5b66\u5bb6\u8b66\u544a\u8bf4\uff0c\u5229\u7387\u8fc7\u4f4e\u7ef4\u6301\u592a\u4e45\u4f1a\u5bfc\u81f4\u901a\u8d27\u81a8\u80c0\u3002", target_words: ["inflation"], start: 7.8, end: 12.4 },
        { en: "Prices start rising faster than wages, and ordinary people find it harder to afford basic goods.", zh: "\u7269\u4ef7\u4e0a\u6da8\u901f\u5ea6\u8d85\u8fc7\u5de5\u8d44\u589e\u957f\uff0c\u666e\u901a\u4eba\u8d8a\u6765\u8d8a\u96be\u4ee5\u8d1f\u62c5\u57fa\u672c\u5546\u54c1\u3002", target_words: [], start: 12.4, end: 17.6 },
        { en: "During the last recession, governments around the world cut rates to help the economy recover.", zh: "\u5728\u4e0a\u4e00\u6b21\u7ecf\u6d4e\u8870\u9000\u671f\u95f4\uff0c\u4e16\u754c\u5404\u56fd\u653f\u5e9c\u7eb7\u7eb7\u964d\u606f\u4ee5\u5e2e\u52a9\u7ecf\u6d4e\u590d\u82cf\u3002", target_words: ["recession"], start: 17.6, end: 22.8 },
        { en: "While this prevented a deeper crisis, it also created new problems.", zh: "\u867d\u7136\u8fd9\u907f\u514d\u4e86\u66f4\u4e25\u91cd\u7684\u5371\u673a\uff0c\u4f46\u4e5f\u5e26\u6765\u4e86\u65b0\u95ee\u9898\u3002", target_words: [], start: 22.8, end: 26.0 },
        { en: "Asset prices climbed rapidly, and the gap between rich and poor grew wider.", zh: "\u8d44\u4ea7\u4ef7\u683c\u8fc5\u901f\u6500\u5347\uff0c\u8d2b\u5bcc\u5dee\u8ddd\u8fdb\u4e00\u6b65\u6269\u5927\u3002", target_words: [], start: 26.0, end: 30.2 },
        { en: "The challenge for policymakers is finding the right balance \u2014 low enough to encourage growth, but not so low that it fuels instability.", zh: "\u51b3\u7b56\u8005\u9762\u4e34\u7684\u6311\u6218\u662f\u627e\u5230\u6070\u5f53\u7684\u5e73\u8861\u2014\u2014\u65e2\u8981\u8db3\u591f\u4f4e\u4ee5\u4fc3\u8fdb\u589e\u957f\uff0c\u53c8\u4e0d\u80fd\u4f4e\u5230\u52a9\u957f\u4e0d\u7a33\u5b9a\u3002", target_words: [], start: 30.2, end: 37.0 }
      ],
      vocabulary: [
        { word: "benchmark", definition_zh: "\u57fa\u51c6\uff1b\u53c2\u7167\u6807\u51c6", cefr: "B2" },
        { word: "recession", definition_zh: "\u7ecf\u6d4e\u8870\u9000", cefr: "B2" },
        { word: "inflation", definition_zh: "\u901a\u8d27\u81a8\u80c0", cefr: "B2" }
      ],
      gist: {
        question: "What is the main point of this passage?",
        options: [
          { text: "Low interest rates always help the economy grow", correct: false },
          { text: "Low interest rates can help recovery but also cause new problems like inflation", correct: true },
          { text: "Governments should never lower interest rates", correct: false }
        ],
        explanation_zh: "\u6587\u7ae0\u7684\u6838\u5fc3\u89c2\u70b9\u662f\u4f4e\u5229\u7387\u662f\u53cc\u5203\u5251\u2014\u2014\u65e2\u80fd\u5e2e\u52a9\u7ecf\u6d4e\u590d\u82cf\uff0c\u4e5f\u4f1a\u5e26\u6765\u901a\u80c0\u548c\u8d2b\u5bcc\u5dee\u8ddd\u7b49\u65b0\u95ee\u9898\u3002"
      }
    },
    {
      id: "practice_b1_psychology_001",
      title: "Why We Trust First Impressions",
      tag: "psychology",
      cefr: "B1",
      target_words: ["cognitive", "bias", "empathy"],
      text: "Our brains make quick judgments about people within seconds of meeting them. This cognitive shortcut helped our ancestors survive in dangerous environments. But in modern life, these snap decisions often lead to bias. We might judge someone as untrustworthy simply because they remind us of someone we disliked in the past. Researchers have found that people who practice empathy \u2014 the ability to understand others\u2019 feelings \u2014 are better at overcoming these automatic judgments. They take time to look beyond surface-level impressions and consider the full picture. The good news is that awareness of our own biases is the first step toward making fairer decisions.",
      lines: [
        { en: "Our brains make quick judgments about people within seconds of meeting them.", zh: "\u6211\u4eec\u7684\u5927\u8111\u5728\u89c1\u5230\u4e00\u4e2a\u4eba\u7684\u51e0\u79d2\u949f\u5185\u5c31\u4f1a\u505a\u51fa\u5feb\u901f\u5224\u65ad\u3002", target_words: [], start: 0, end: 4.5 },
        { en: "This cognitive shortcut helped our ancestors survive in dangerous environments.", zh: "\u8fd9\u79cd\u8ba4\u77e5\u6377\u5f84\u5e2e\u52a9\u6211\u4eec\u7684\u7956\u5148\u5728\u5371\u9669\u7684\u73af\u5883\u4e2d\u751f\u5b58\u4e0b\u6765\u3002", target_words: ["cognitive"], start: 4.5, end: 8.8 },
        { en: "But in modern life, these snap decisions often lead to bias.", zh: "\u4f46\u5728\u73b0\u4ee3\u751f\u6d3b\u4e2d\uff0c\u8fd9\u4e9b\u8349\u7387\u7684\u51b3\u5b9a\u5f80\u5f80\u4f1a\u5bfc\u81f4\u504f\u89c1\u3002", target_words: ["bias"], start: 8.8, end: 12.4 },
        { en: "We might judge someone as untrustworthy simply because they remind us of someone we disliked in the past.", zh: "\u6211\u4eec\u53ef\u80fd\u4ec5\u4ec5\u56e0\u4e3a\u67d0\u4eba\u8ba9\u6211\u4eec\u60f3\u8d77\u8fc7\u53bb\u4e0d\u559c\u6b22\u7684\u4eba\uff0c\u5c31\u5224\u5b9a\u4ed6\u4e0d\u53ef\u4fe1\u3002", target_words: [], start: 12.4, end: 18.2 },
        { en: "Researchers have found that people who practice empathy \u2014 the ability to understand others\u2019 feelings \u2014 are better at overcoming these automatic judgments.", zh: "\u7814\u7a76\u4eba\u5458\u53d1\u73b0\uff0c\u90a3\u4e9b\u7ec3\u4e60\u5171\u60c5\u2014\u2014\u5373\u7406\u89e3\u4ed6\u4eba\u611f\u53d7\u7684\u80fd\u529b\u2014\u2014\u7684\u4eba\u66f4\u64c5\u957f\u514b\u670d\u8fd9\u4e9b\u81ea\u52a8\u5224\u65ad\u3002", target_words: ["empathy"], start: 18.2, end: 25.6 },
        { en: "They take time to look beyond surface-level impressions and consider the full picture.", zh: "\u4ed6\u4eec\u4f1a\u82b1\u65f6\u95f4\u770b\u5230\u8868\u9762\u5370\u8c61\u4e4b\u5916\u7684\u4e1c\u897f\uff0c\u8003\u8651\u5168\u8c8c\u3002", target_words: [], start: 25.6, end: 30.0 },
        { en: "The good news is that awareness of our own biases is the first step toward making fairer decisions.", zh: "\u597d\u6d88\u606f\u662f\uff0c\u610f\u8bc6\u5230\u81ea\u5df1\u7684\u504f\u89c1\u662f\u505a\u51fa\u66f4\u516c\u6b63\u51b3\u5b9a\u7684\u7b2c\u4e00\u6b65\u3002", target_words: ["bias"], start: 30.0, end: 35.5 }
      ],
      vocabulary: [
        { word: "cognitive", definition_zh: "\u8ba4\u77e5\u7684", cefr: "B2" },
        { word: "bias", definition_zh: "\u504f\u89c1\uff0c\u504f\u5dee", cefr: "B2" },
        { word: "empathy", definition_zh: "\u5171\u60c5\uff0c\u540c\u7406\u5fc3", cefr: "B2" }
      ],
      gist: {
        question: "What does the passage suggest about first impressions?",
        options: [
          { text: "First impressions are always accurate and should be trusted", correct: false },
          { text: "Quick judgments can be biased, but empathy and awareness can help us overcome them", correct: true },
          { text: "Scientists have found no way to improve our judgment of others", correct: false }
        ],
        explanation_zh: "\u6587\u7ae0\u7684\u6838\u5fc3\u662f\uff1a\u7b2c\u4e00\u5370\u8c61\u662f\u8fdb\u5316\u9057\u7559\u7684\u8ba4\u77e5\u6377\u5f84\uff0c\u5bb9\u6613\u5e26\u6765\u504f\u89c1\uff0c\u4f46\u901a\u8fc7\u5171\u60c5\u548c\u81ea\u6211\u89c9\u5bdf\u53ef\u4ee5\u514b\u670d\u3002"
      }
    }
  ];

  /** Inject mock vocab into localStorage if fewer than 5 words (demo only) */
  function initMockVocab() {
    var raw = localStorage.getItem('flipodVocab');
    var existing = [];
    try { existing = JSON.parse(raw) || []; } catch (e) { /* ignore */ }
    if (existing.length < 5) {
      localStorage.setItem('flipodVocab', JSON.stringify(MOCK_VOCAB));
      return MOCK_VOCAB;
    }
    return existing;
  }

  window.LP_MOCK = {
    MOCK_VOCAB: MOCK_VOCAB,
    MOCK_PRACTICES: MOCK_PRACTICES,
    initMockVocab: initMockVocab
  };
})();
