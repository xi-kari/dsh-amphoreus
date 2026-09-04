import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { seatContrastReport } from '../src/client/seat-theme.ts'

let failed = false
for (const hero of HERO_VISUALS) {
  const report = seatContrastReport(hero)
  for (const scheme of ['light', 'dark'] as const) {
    for (const row of report[scheme]) {
      const status = row.ok ? 'OK' : 'FAIL'
      console.log(`${hero.heroId} | ${scheme} | ${row.pair} | ${row.ratio.toFixed(3)} | ${row.min.toFixed(1)} | ${status}`)
      if (!row.ok) failed = true
    }
  }
}
if (failed) process.exitCode = 1
