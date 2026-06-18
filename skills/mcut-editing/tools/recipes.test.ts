import { describe, expect, test } from 'bun:test'
import { lintProject } from '@mcut/cli'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { RECIPES } from './recipes'
import { TEMPLATES, buildTemplate } from './templates'

describe('templates', () => {
  for (const template of TEMPLATES) {
    test(`${template.id} parses, lints clean, and is byte-stable`, () => {
      const project = template.build()
      // Round-trip through JSON the way a consumer would load it.
      parseProject(JSON.parse(JSON.stringify(project)))
      expect(lintProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
      // generate.ts output is diffed in CI; two builds must be identical.
      expect(JSON.stringify(template.build())).toBe(JSON.stringify(project))
    })
  }
})

describe('recipes', () => {
  for (const recipe of RECIPES) {
    test(`${recipe.id} replays against ${recipe.template} and verifies`, () => {
      let project = buildTemplate(recipe.template)
      if (recipe.commands) {
        const engine = new EditorEngine({ project })
        for (const command of recipe.commands) engine.dispatch(command)
        project = engine.project
      }
      if (recipe.apply) project = recipe.apply(project)
      recipe.verify(project)
      expect(lintProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
    })
  }
})
