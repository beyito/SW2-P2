/**
 * Skills de los agentes (RF-11): cada una es una carpeta con un SKILL.md que declara quién puede usarla,
 * qué herramientas tiene permitidas y cómo debe trabajar. Agregar un agente no exige escribir otro ciclo.
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const REQUIRED = ['name', 'title', 'description', 'roles', 'tools'];

function parseValue(raw) {
  const value = raw.trim();
  if (!value.startsWith('[')) return value;
  return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
}

/** Lee un SKILL.md. Un archivo mal escrito impide arrancar: un agente sin límites claros no debe funcionar. */
function parseSkill(text, source) {
  const match = FRONT_MATTER.exec(text);
  if (!match) throw new Error(`${source}: falta el encabezado de la Skill.`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1));
  }
  for (const field of REQUIRED) {
    if (!fields[field]?.length) throw new Error(`${source}: falta el campo '${field}'.`);
  }
  return { ...fields, instructions: match[2].trim() };
}

/**
 * Carga las Skills y comprueba que solo pidan herramientas existentes.
 * Las que deciden por una persona quedan excluidas aquí, para que ningún archivo pueda otorgárselas al modelo.
 */
function loadSkills({ dir = SKILLS_DIR, knownTools, humanOnlyTools }) {
  const skills = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(dir, entry.name, 'SKILL.md');
    const skill = parseSkill(fs.readFileSync(source, 'utf8'), source);
    for (const tool of skill.tools) {
      if (humanOnlyTools.has(tool)) throw new Error(`${source}: '${tool}' solo la puede usar una persona.`);
      if (!knownTools.has(tool)) throw new Error(`${source}: la herramienta '${tool}' no existe.`);
    }
    skills[skill.name] = skill;
  }
  return skills;
}

module.exports = { loadSkills, parseSkill };
