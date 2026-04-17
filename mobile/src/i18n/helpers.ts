import type { Topic } from '../types';
import { normalizeTopic } from '../feed-ranking';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function getLocalizedTopicLabel(topic: Topic | string | null | undefined, t: TranslateFn) {
  const normalized = normalizeTopic(String(topic || 'story'));
  return t(`topics.${normalized}`);
}

export function joinLocalizedTopics(
  topics: Array<Topic | string | null | undefined>,
  t: TranslateFn
) {
  const labels = topics
    .map(topic => getLocalizedTopicLabel(topic, t))
    .filter(Boolean);

  return labels.join(', ');
}
