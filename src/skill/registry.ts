import type { Skill } from './types.js'

const skills = new Map<string, Skill>()

export function registerSkill(skill: Skill): void {
  skills.set(skill.name, skill)
}

export function getSkill(name: string): Skill | undefined {
  return skills.get(name)
}

export function getAllSkills(): Skill[] {
  return [...skills.values()]
}
