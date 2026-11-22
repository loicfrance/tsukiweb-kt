/**
 * Extract the daily messages of each fullscript and store them in the
 * `daily-messages` attribute of the language's game.json.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '@tsukiweb/common/tools/utils/logger.ts'
import { fullscripts, loadLangPreprocess, outputPathPrefix } from './fullscripts.ts'

const ENTRY_LABEL = 'select_message'
const MSG_LINES = 9
const ORIGINAL_IMAGE_DIR = 'msg'
const MAX_STEPS = 100000
const IGNORED_COMMANDS = ['lsp', 'bg', 'csp', 'print', 'setwindow', 'inc', 'dec']

type DailyMessage = { text: string[], fg?: string, bg?: string }
type DailyMessages = {
	random: DailyMessage[]
	dates: Record<string, DailyMessage>
}
type LineFix = (line: string)=> string
type Value = string|number

const RETURN = Symbol('return')

//#endregion ###################################################################
//#region                          INTERPRETER
//##############################################################################

function splitStatements(line: string) {
	const statements = []
	let current = ''
	let quoted = false
	for (const c of line) {
		if (c == '"') quoted = !quoted
		if (c == ':' && !quoted) {
			statements.push(current.trim())
			current = ''
		} else {
			current += c
		}
	}
	statements.push(current.trim())
	return statements.filter(s => s.length > 0)
}

function imageId(value: string) {
	const m = value.match(/image\\(\w+)\\(\w+?)(?:_(?:en|pt))?\.\w+$/)
	if (!m) throw Error(`Unexpected daily message image ${value}`)
	return `${m[1]}/${m[2]}`
}

class Interpreter {
	private lines: string[]
	private labels = new Map<string, number>()
	private vars = new Map<string, Value>()
	private out: string[] = []
	private indent = ''
	private steps = 0
	private msgno = 0
	private date = { month: 0, day: 0 }
	msgCount = 0

	constructor(script: string) {
		this.lines = script.split(/\r?\n/).map(l => l.trim())
		for (const [i, line] of this.lines.entries()) {
			const m = line.match(/^\*(\w+)/)
			if (m) this.labels.set(m[1], i)
		}
		if (!this.labels.has(ENTRY_LABEL))
			throw Error(`Missing label *${ENTRY_LABEL}`)
	}

	get dates() {
		const start = this.labels.get(ENTRY_LABEL)!
		let end = this.lines.findIndex((l, i) => i > start && l.startsWith('*'))
		if (end < 0) end = this.lines.length
		const dates = new Set<string>()
		for (const line of this.lines.slice(start, end)) {
			const m = line.match(/^`?\s*if\s+%month==(\d+)\s*&&\s*%day==(\d+)/)
			if (m) dates.add(`${+m[1]}-${+m[2]}`)
		}
		return [...dates].map(d => d.split('-').map(Number) as [number, number])
	}

	run(msgno: number, month = 0, day = 0): DailyMessage {
		this.vars = new Map<string, Value>([
			['%fixmsg', -1], ['%lastmsgno0', -1],
			['%lastmsgno1', -1], ['%lastmsgno2', -1],
		])
		this.out = []
		this.indent = ''
		this.steps = 0
		this.msgno = msgno
		this.date = { month, day }
		this.call(ENTRY_LABEL)

		const text = this.out.length > 0 ? this.out
			: Array.from({ length: MSG_LINES }, (_, i) => this.str(`$msgline${i}`))
		const fg = this.str('$msgfg'), bg = this.str('$msgbg')
		return {
			text,
			...(fg && { fg: imageId(fg) }),
			...(bg && { bg: imageId(bg) }),
		}
	}

	private get(name: string): Value {
		return this.vars.get(name) ?? (name.startsWith('$') ? '' : 0)
	}
	private str(name: string) {
		return String(this.get(name))
	}
	private value(arg: string): Value {
		arg = arg.trim()
		if (arg.startsWith('"')) return arg.substring(1, arg.lastIndexOf('"'))
		if (/^[%$]\w+$/.test(arg)) return this.get(arg)
		if (/^-?\d+$/.test(arg)) return +arg
		throw Error(`Unexpected value ${arg}`)
	}

	private test(condition: string): boolean {
		return condition.split('&&').every(part => {
			const m = part.trim().match(/^(%\w+|-?\d+)\s*(==|!=|>=|<=|>|<)\s*(%\w+|-?\d+)$/)
			if (!m) throw Error(`Unable to parse condition "${part}"`)
			const lhs = +this.value(m[1]), rhs = +this.value(m[3])
			switch (m[2]) {
				case '==': return lhs == rhs
				case '!=': return lhs != rhs
				case '>=': return lhs >= rhs
				case '<=': return lhs <= rhs
				case '>' : return lhs > rhs
				default  : return lhs < rhs
			}
		})
	}

	private call(label: string) {
		if (!this.labels.has(label)) throw Error(`Unknown label *${label}`)
		let pc: number|typeof RETURN = this.labels.get(label)! + 1
		while (pc !== RETURN) {
			if (pc >= this.lines.length) throw Error(`Reached end of script in *${label}`)
			if (++this.steps > MAX_STEPS) throw Error(`Too many steps in *${label}`)
			pc = this.execLine(pc)
		}
	}

	private execLine(pc: number): number|typeof RETURN {
		let line = this.lines[pc]
		if (/^`\s*(if\s+%|mov\s+[$%])/.test(line))
			line = line.substring(1).trim()
		if (!line || line.startsWith(';') || line.startsWith('*') || line.startsWith('~'))
			return pc + 1
		if (line.startsWith('`')) {
			this.out.push(this.indent + line.substring(1))
			this.indent = ''
			return pc + 1
		}
		const m = line.match(/^if\s+(.*?)\s+((?:mov|gosub|skip|jumpf|goto|return)\b.*)$/)
		if (m) {
			if (!this.test(m[1])) return pc + 1
			line = m[2]
		}
		for (const statement of splitStatements(line)) {
			const [, cmd, args = ''] = statement.match(/^(\S+)\s*(.*)$/)!
			switch (cmd) {
				case 'mov': {
					const m = args.match(/^([$%]\w+)\s*,?\s*(.*)$/)
					if (!m) throw Error(`Unable to parse "${statement}"`)
					this.vars.set(m[1], this.value(m[2]))
					break
				}
				case 'rnd': {
					const [name, max] = args.split(',').map(a => a.trim())
					if (name == '%msgno') {
						this.msgCount = +max
						this.vars.set(name, this.msgno)
					} else {
						this.vars.set(name, -1)
					}
					break
				}
				case 'date':
					this.vars.set('%month', this.date.month)
					this.vars.set('%day', this.date.day)
					break
				case 'skip': return pc + +args
				case 'jumpf': {
					const target = this.lines.findIndex((l, i) => i > pc && l.startsWith('~'))
					if (target < 0) throw Error(`'jumpf' without '~' (line ${pc + 1})`)
					return target + 1
				}
				case 'gosub': this.call(args.replace(/^\*/, '')); break
				case 'goto':
					this.call(args.replace(/^\*/, ''))
					return RETURN
				case 'return': return RETURN
				case 'br': this.out.push(''); break
				case 'locate': {
					const [x, y] = args.split(',').map(Number)
					while (this.out.length < y) this.out.push('')
					this.indent = '　'.repeat(x)
					break
				}
				default:
					if (!IGNORED_COMMANDS.includes(cmd))
						throw Error(`Unexpected command "${statement}" (line ${pc + 1})`)
			}
		}
		return pc + 1
	}
}

//#endregion ###################################################################
//#region                            CLEANUP
//##############################################################################

function cleanLine(line: string, fix?: LineFix) {
	line = line
		.replaceAll(/[@`]/g, '')
		.replace(/\\$/, '')
		.replaceAll('^', ' ')
		.replaceAll(/(?<=\S) {2,}/g, ' ')
		.replaceAll(/(?<=[^\x00-\x7f])_|_(?=[^\x00-\x7f])/g, '')
		.trimEnd()
	if (fix) line = fix(line)
	return /^[\s　]*$/.test(line) ? '' : line
}

function cleanMessage(msg: DailyMessage, fix?: LineFix): DailyMessage {
	const text = msg.text.map(line => cleanLine(line, fix))
	while (text.length > 0 && !text.at(-1)) text.pop()
	while (text.length > 0 && !text[0]) text.shift()
	return { ...msg, text }
}

//#endregion ###################################################################
//#region                             MAIN
//##############################################################################

function isOriginal(msg: DailyMessage) {
	return [msg.fg, msg.bg].every(img => !img || img.startsWith(`${ORIGINAL_IMAGE_DIR}/`))
}

export function extractDailyMessages(script: string, fix?: LineFix): DailyMessages {
	const interpreter = new Interpreter(script)
	const dates = Object.fromEntries(interpreter.dates.map(([month, day]) =>
		[`${month}-${day}`, cleanMessage(interpreter.run(0, month, day), fix)]
	))
	const random = [cleanMessage(interpreter.run(0), fix)]
	for (let i = 1; i < interpreter.msgCount; i++)
		random.push(cleanMessage(interpreter.run(i), fix))
	return { random: random.filter(msg => msg.text.length > 0 && isOriginal(msg)), dates }
}

function processSingleScript(folder: string, filename: string) {
	let txt = fs.readFileSync(path.join(outputPathPrefix, folder, 'sources', filename), 'utf-8')
	const { kt_raw_fixes, kt_daily_message_fixes: fix } = loadLangPreprocess(folder)
	txt = kt_raw_fixes?.(txt) || txt
	const messages = extractDailyMessages(txt, fix)

	const gameJsonPath = path.join(outputPathPrefix, folder, 'game.json')
	if (!fs.existsSync(gameJsonPath)) {
		logger.error(`game.json not found at ${gameJsonPath}`)
		return
	}
	const gameJson = JSON.parse(fs.readFileSync(gameJsonPath, 'utf-8'))
	gameJson['daily-messages'] = messages
	fs.writeFileSync(gameJsonPath, JSON.stringify(gameJson, null, 2) + '\n')
	return messages
}

export function main() {
	const totalScripts = fullscripts.length
	let processedCount = 0
	for (const [folder, filename] of fullscripts) {
		processedCount++
		logger.progress(`Extracting daily messages: ${processedCount}/${totalScripts} (${filename})`)
		try {
			processSingleScript(folder, filename)
		} catch (e) {
			logger.error(`Error processing ${filename}: ${(e as Error).message}`)
		}
	}
	logger.progress(`Extracting daily messages: ${processedCount}/${totalScripts}\n`)
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
	main()
}
