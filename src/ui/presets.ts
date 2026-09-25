export const PERSONALITY_PRESETS: { id: string; label: string; text: string }[] = [
  {
    id: 'aggressive',
    label: 'Aggressive（ガンガンいこうぜ）',
    text: '大胆不敵。状況を一気に変えそうな大きなリンク（国・大都市・広域概念）を好み、遠回りやリスクを恐れない。迷ったら勝負に出る。',
  },
  {
    id: 'balanced',
    label: 'Balanced（バランスよく）',
    text: 'ゴールとの関連性と安全性のバランスを重視する。極端な賭けは避け、着実に近づいていると思えるリンクを選ぶ。',
  },
  {
    id: 'explorer',
    label: 'Explorer（いろいろやろうぜ）',
    text: '好奇心旺盛。定番のルートだけでなく、意外なつながりや未知の方向のリンクを試したがる。ひらめきによるショートカットを狙う。',
  },
  {
    id: 'cautious',
    label: 'Cautious（いのちだいじに）',
    text: '慎重派。行き止まりや迷走を嫌い、地名・行政区画・交通路線など確実に地理的につながるリンクを好む。BACK は温存したい。',
  },
]

export const DEFAULT_RUNNERS = [
  { name: 'ガンガン', icon: '🔥', personality: PERSONALITY_PRESETS[0].text },
  { name: 'バランス', icon: '⚖️', personality: PERSONALITY_PRESETS[1].text },
  { name: 'タンケン', icon: '🧭', personality: PERSONALITY_PRESETS[2].text },
  { name: 'ダイジニ', icon: '🛡️', personality: PERSONALITY_PRESETS[3].text },
]
