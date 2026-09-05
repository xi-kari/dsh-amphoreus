/**
 * Per-seat hero greetings: UI copy owned by this plugin (not skill content), one
 * short line per day part, written in each Chrysos Heir's register and always
 * addressing the Trailblazer. The global (Cyrene) space keeps the neutral line.
 */
export type DayPart = 'morning' | 'afternoon' | 'evening'

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

const GLOBAL: Readonly<Record<DayPart, string>> = {
  morning: '早上好，开拓者',
  afternoon: '下午好，开拓者',
  evening: '晚上好，开拓者',
}

const SEAT_GREETINGS: Readonly<Record<string, Readonly<Record<DayPart, string>>>> = {
  tribbie: { morning: '早上好~晴天雨天都好，开拓者！', afternoon: '中午好~缇宁说该吃点心了，开拓者', evening: '晚上好~缇安说要早点睡哦，开拓者' },
  cerydra: { morning: '免礼。天光甚好，开拓者，先手让你。', afternoon: '午间正宜推演一局。开拓者，说你的议题。', evening: '夜深，棋局未收。开拓者，落子吧。' },
  march7th: { morning: '早啊，开拓者。今天也是命运般的邂逅。', afternoon: '下午好，开拓者。要不要来点秘密？', evening: '晚上好。夜色正合我意，开拓者。' },
  terrae: { morning: '早。开拓者，像往常那样就好。', afternoon: '下午了。有事直说，开拓者。', evening: '夜里安静，适合把话说清楚，开拓者。' },
  hysilens: { morning: '晨光如潮。开拓者，来共演一曲？', afternoon: '午后的宴席还未散场，开拓者。', evening: '盛宴在即。开拓者，今晚想听什么？' },
  hyacine: { morning: '早上好！开拓者，今天的心情要不要来庭院晒一晒？', afternoon: '下午茶时间到~开拓者，先坐下歇歇。', evening: '晚上好呀，开拓者。有心事的话，我在听。' },
  phainon: { morning: '早啊开拓者！走，一起练练手？', afternoon: '下午好！开拓者，今天想干点什么？', evening: '晚上好。开拓者，今天也辛苦了。' },
  anaxa: { morning: '怎么？一早就有问题？问吧，开拓者。', afternoon: '下午好。什么问题？开拓者，直接说。', evening: '夜里思路更清楚。有问题？问吧，开拓者。' },
  aglaea: { morning: '早安。开拓者，在奥赫玛的清晨可还愉快？', afternoon: '午安。如有吩咐，尽可向「衣匠」传达，开拓者。', evening: '夜色尚早。开拓者，圣城为你留着灯。' },
  mydei: { morning: '嗯。开拓者。', afternoon: '嗯。开拓者，说。', evening: '嗯。夜里也不歇？开拓者。' },
  castorice: { morning: '早上好，开拓者。要不要一起去日光下走走？', afternoon: '下午好，开拓者。日光正暖。', evening: '晚上好，开拓者。冷么？' },
  cipher: { morning: '我说灰子——开拓者，一早去哪发财？', afternoon: '下午好呀开拓者~今天收益如何？', evening: '晚上好，开拓者。夜里正适合谈生意~' },
}

/** Greeting line for a seat (null/unknown → the neutral global line). */
export function seatGreetingFor(heroId: string | null | undefined, hour: number): string {
  const part = dayPartOf(hour)
  return (heroId === null || heroId === undefined ? undefined : SEAT_GREETINGS[heroId]?.[part]) ?? GLOBAL[part]
}

/** Hero ids that carry a bespoke greeting (exported for tests / audits). */
export const GREETING_HERO_IDS: readonly string[] = Object.keys(SEAT_GREETINGS)
