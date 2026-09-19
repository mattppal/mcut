import { describe, expect, test } from 'bun:test'
import { lintProject } from '@mcut/cli'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { RECIPES } from './recipes'
import { TEMPLATES, buildTemplate } from './templates'

describe('templates', () => {
  for (const template of TEMPLATES) {
    test(`${template.id} parses, lints clean, and two builds are byte-identical`, () => {
      const project = template.build()
      parseProject(JSON.parse(JSON.stringify(project)))
      expect(lintProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
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
