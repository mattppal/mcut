import { DRIVERS } from './drivers/index.ts'
import { FEATURE_TABLE, SURFACES, type Feature, type Surface } from './features.ts'

type Cell = 'driven' | 'gap' | 'unsupported'

function cell(feature: Feature, surface: Surface): Cell {
  if (feature.surfaces[surface].kind === 'unsupported') return 'unsupported'
  return DRIVERS[feature.id] === null ? 'gap' : 'driven'
}

const MARK: Record<Cell, string> = { driven: 'driven', gap: 'GAP', unsupported: 'n/a' }

function main(): void {
  const strict = process.argv.includes('--strict')
  const lines = ['| Feature | Tier | ' + SURFACES.join(' | ') + ' |', '| --- | --- | ' + SURFACES.map(() => '---').join(' | ') + ' |']
  const gaps: string[] = []
  const driven: Record<Surface, number> = { embed: 0, 'electron-dev': 0, installed: 0 }
  const drivable: Record<Surface, number> = { embed: 0, 'electron-dev': 0, installed: 0 }
  for (const feature of FEATURE_TABLE) {
    const cells = SURFACES.map((surface) => {
      const value = cell(feature, surface)
      if (value !== 'unsupported') drivable[surface] += 1
      if (value === 'driven') driven[surface] += 1
      if (value === 'gap') gaps.push(`${feature.id} on ${surface}`)
      return MARK[value]
    })
    lines.push(`| ${feature.id} | ${feature.tier} | ${cells.join(' | ')} |`)
  }
  console.log(lines.join('\n'))
  console.log('')
  for (const surface of SURFACES) console.log(`coverage ${surface}: ${driven[surface]} of ${drivable[surface]} drivable features have a driver`)
  if (gaps.length > 0) {
    console.log(`\n${gaps.length} gaps:`)
    for (const gap of gaps) console.log(`- ${gap}`)
  }
  if (strict && gaps.length > 0) process.exit(1)
}

main()
