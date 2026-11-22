/**
 * Convert a script file into a folder of scenes in the format
 * used by the parser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'
import { parseScript } from '@tsukiweb/common/tools/convert-scripts/parsers/nscriptr.ts';
import { Block, CommandToken, ConditionToken, LabelToken, ReturnToken, TextToken, Token } from '@tsukiweb/common/tools/convert-scripts/parsers/utils.ts'
import { generateScenes, splitBlocks } from '../utils/nscriptr_convert.ts';
import { logger } from '@tsukiweb/common/tools/utils/logger.ts';
import { updateGameJsonWithChoices } from '../utils/choices_extractor.ts';
import { isLogicLabel, isSceneLabel, processVarName } from './common.ts';
import { addChoiceCondition, isCmd, processCondition } from '@tsukiweb/common/tools/convert-scripts/utils.ts';
import { fullscripts, loadLangPreprocess, outputPathPrefix } from './fullscripts.ts';

const LOGIC_FILE = "logic"
const GEN_CHOICES_JSON = true
const GEN_TREE 		   = true
const GEN_LOGIC 	   = true

//#endregion ###################################################################
//#region                             FIXES
//##############################################################################

const redirected_scenes = {
	f400: null, f402: null, // replaced by 401
	f218: null, // replaced by 214
	twilight_op_2 : "f521", // renamed
	twilight_op_3 : "f522", // renamed
	nop: "endofplay",
	start: "endofplay",
}

function redirect(token: CommandToken) {
	for (const [i, arg] of token.args.entries()) {
		if (typeof arg == 'string' && arg.startsWith('*')) {
			let label: string|null = arg.substring(1)
			if (label in redirected_scenes) {
				label = redirected_scenes[label as keyof typeof redirected_scenes]
				if (!label)
					return false
				token.args[i] = `*${label}`
			}
		}
	}
}

function logic_tokenFixes(token: Token): void|boolean|string {
	if (token instanceof ReturnToken) return false
	if (token instanceof TextToken) return false
	if (token instanceof LabelToken) return true
	if (token instanceof ConditionToken) {
		const condition = processCondition(token.condition, processVarName)
		if (!condition)
			return false
		token.condition = condition
		return true
	}
	if (token instanceof CommandToken) {
		switch (token.cmd) {
			case 'br': case 'skip': case '!sd': case 'bg':
				return false
			case 'mov': case 'add': case 'sub': case 'inc': case 'dec':
				let varName = processVarName(token.args[0])
				if (!varName) return false
				if (varName)
					token.args[0] = varName
				return true
			case 'gosub':
				token.cmd = 'goto'
				if (/^\*s\d+$/.test(token.args[0])) {// gosub *sXXX
					redirect(token)
				}
				return true
			case 'goto':
				return redirect(token);
			case 'selgosub' :
			case 'select':
				token.cmd = 'select'
				token.args = token.args.map(x=>(x).trim())
				return redirect(token)
			case '\\' :
				return false; // only one occurrence on a failsafe path
			case 'rnd' :
				if (token.args[0] != '%msgno' || token.args[1] != '3')
					throw Error(`Expected arguments "%msgno,3" for "rnd" command`)
				return true
			case 'jumpf' :
			case '~' :
				return true // only one occurrence in jp yume07
			default:
				throw Error(`Unrecognized command ${token.toString()}`)
		}
	}
	throw Error(`Unrecognized token type of ${token}`)
}
function insertSceneEnd(blocks: Map<string, Block>, block: Block) {
	for (const [token, index] of block) {
		if (isCmd(token, 'goto')) {
			const scene = token.args[0].substring(1) // exclude '*' at the start
			if (isSceneLabel(scene)) {
				if (/^quiz\d$/.test(scene)) {
					debugger;
				} else {
					const sceneEndBlock = block.split(index+1, `${scene}_end`)
					blocks.set(sceneEndBlock.name, sceneEndBlock)
				}
			}
		}
	}
}


function getBlockProps(
		lang_block_fixes: Map<string, (block: Block)=>void>,
		label: string) {
	const tokenFixes = [logic_tokenFixes]
	const blockFixes: ((block: Block)=>void)[] = []
	if (isLogicLabel(label)) {
		switch (label) {
			case 'f21' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken && (t.command as CommandToken).args[0] == 'f401')
						t.condition = "%flgO || %flgQ"
				})
				break
			case 'f41' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken)
						return false
					if (t instanceof CommandToken && t.cmd == 'goto')
						t.args[0] = '*f43'
				})
				break
			case 'f43' : tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select')
						addChoiceCondition(t, "*f194", "%ark_point>=1 || %cel_point>=1")
				})
				break;
			case 'f63' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken) {
						if (t.condition == '%flgM<1') return false
						else if (t.condition == '%flgA>=1') t.condition += " && %flgM>=1"
					}
				})
				break
			case 'f67' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken) {
						if (!['*f305', '*f306'].includes((t.command as CommandToken).args[0]))
							return false
					} else if (t instanceof CommandToken && t.args[0] == '*f68')
						t.args[0] = '*f248'
				})
				break
			case 'f154' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken)
						return false
					if (t instanceof CommandToken && t.args[0] == '*f155')
						t.args[0] = '*f156'
				})
				break
			case 'f156': tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select')
						addChoiceCondition(t, "*f172", "%flgP")
				})
				break
			case 'f157' : tokenFixes.push(t=> {
					if (isCmd(t, 'mov', "$nextflow")) {
						(t as CommandToken).cmd = 'inc'
						t.args = ['%flg_arkroom']
					}
				})
				break
			case 'f160' : tokenFixes.push(t=> {
					if (isCmd(t, 'mov', "$nextflow")) {
						(t as CommandToken).cmd = 'inc'
						t.args = ['%flg_kissa']
					}
				})
				break
			case 'f170' : tokenFixes.push(t=> {
					if (isCmd(t, 'mov', "$nextflow")) {
						return false
					}
				})
				break
			case 'f173' : tokenFixes.push(t=> {
					if (isCmd(t, 'mov', "$nextflow")) {
						(t as CommandToken).cmd = 'inc'
						t.args = ['%flg_celroom']
					}
				})
				break
			case 'f179' : tokenFixes.push(t=> {
					if (isCmd(t, 'goto', '$nextflow'))
						return `
						if %flg_kissa>0 goto *f161
						if %flg_celroom>0 goto *f174
						if %flg_arkroom>0 goto *f158
						goto *f171`
				})
				break
			case 'f195' : tokenFixes.push(t=> {
                    if (t instanceof ConditionToken && t.condition.includes('flg6'))
                        return false // flg6 implies flg5 (previous condition)
                })
                break
			case 'f201' : tokenFixes.push(t=> {
					if (t instanceof ConditionToken)
						return false
				})
				break
			case 'f202' : tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select')
						addChoiceCondition(t, "*f205", "%flg5<1")
				})
				break
			case 'f214': tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select') {
						addChoiceCondition(t, "*f215", "%flg5<1")
					}
				})
				break
			case 'f248' : tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select') {
						addChoiceCondition(t, "*f84", "%kaibyo_point>=2")
						addChoiceCondition(t, "*f85", "%flg3 && %flg4<1")
						addChoiceCondition(t, "*f250", "%ren_point>=6 && %flg5<1")
					}
				})
				break

			case 'f250' : tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select') {
						if (t.args.includes("*f256"))
							addChoiceCondition(t, "*f256", "%flg6==0")
						else
							return false // only keep first select
					}
				})
				break
			case 'f401' : tokenFixes.push(t=> {
					if (t instanceof CommandToken && t.cmd == 'select') {
						addChoiceCondition(t, "*f223", "%flgO")
						addChoiceCondition(t, "*f501", "%flgQ")
					}
				})
				break
			case 'quiz' :
				blockFixes.push(block=>block.replace(1, block.length,`
					mov %answer_point,-1
					rngsel *quiz1,*quiz2,*quiz3`))
				break
			case 'f136' :
				blockFixes.push(block=>block.insert(0, `mov %answer_point,0`))
				break
			case 'f137' :
				blockFixes.push(block=>block.insert(0, `mov %answer_point,0`))
				break
			case 'twilight_op' :
				blockFixes.push(b=> {
					b.name = (b.at(0) as LabelToken).label = "f520"
				})
				tokenFixes.push(t=> {
					if (isCmd(t, "select"))
						addChoiceCondition(t, "*f522", "%flg8>=1")
					else if (t instanceof ConditionToken)
						return false
				})
				break
			case 'twilight_op_2' :
				blockFixes.push(b=> {
					b.name = (b.at(0) as LabelToken).label = "f521"
				})
				tokenFixes.push(t=> {
					if (isCmd(t, 'goto', '*twilight'))
						t.args[0] = '*f500'
				})
				break
			case 'twilight_op_3' :
				blockFixes.push(b=> {
					b.name = (b.at(0) as LabelToken).label = "f522"
				})
				tokenFixes.push(t=> {
					if (isCmd(t, 'goto', '*twilight'))
						t.args[0] = '*f523'
				})
				break
			case 'twilight_ep' :
				blockFixes.push(b=> {
					b.name = (b.at(0) as LabelToken).label = "f523"
				})
				tokenFixes.push(t=> {
					if (isCmd(t, 'goto', '*title'))
						t.args[0] = '*endofplay'
				})
				break
			case 'yume07' :
				blockFixes.push(b=> {
					const i = b.findIndex(t=>t instanceof ConditionToken && (t.command as CommandToken).cmd == 'jumpf')
					if (i >= 0) {
						const j = b.findIndex(t=>isCmd(t, '~'), i+1)
						if (j < 0) throw Error(`Expected '~' after jumpf`)
						b.delete(i, j-i+1)
					}
				})
				break
			case 'yume01' : case 'yume02' : case 'yume03' : case 'yume04' :
			case 'yume05' : case 'yume06' : case 'yume06' : case 'yume08' :
			case 'yume09' : case 'yume10' :
			case 'summer_ark' : case 'summer_ciel' : case 'summer_akiha' :
			case 'summer_hisui' : case 'summer_kohaku' : case 'yoiyumetsuki' :
				blockFixes.push(b=> {
					const i = b.findIndex(t=>isCmd(t, 'goto'))
					b.replace(i+1, b.length-i-1, `goto *endofplay`)
				})
				break
			case 'f42' : // -> f43
			case 'f68' : case 'f69' : case 'f70' : case 'f71' : // -> f248
			case 'f155' : // -> f156
			case 'f206' : // -> f202
			case 'f218' : // -> f214
			case 'f245' : case 'f246' : case 'f247' : // -> f248
			case 'f400' : case 'f402' : // -> f401
				return null
		}
		if (lang_block_fixes.has(label))
			blockFixes.push(lang_block_fixes.get(label)!)
		blockFixes.push((b)=> {
			// delete all lines after a select
			const i = b.findIndex(t=>isCmd(t, 'select'));
			if (i >= 0 && i < b.length-1) {
				b.delete(i+1, b.length-i-1)
			}
		})
		return { tokenFixes: tokenFixes, blockFixes: blockFixes }
	} else {
		return null
	}
}

function interBlockFixes(blocks: Map<string, Block>) {
	for (const block of blocks.values()) {
		insertSceneEnd(blocks, block)
	}

	{ // f135 handles quiz result. Move to quiz(1|2|3)_end
		const s135_end = blocks.get('s135_end')!
		const i = s135_end.indexOf('goto *quiz')
		if (i < 0) throw Error(`Expected 'gosub *quiz' in f135`)
		s135_end.delete(i+1, s135_end.length - (i+1))
		for (let i=1; i <= 3; i++) {
			const blockName = `quiz${i}_end`
			blocks.set(blockName, new Block(blockName, parseScript(`
				*${blockName}
				if %answer_point<0 && %flg_quiz${i}>0 goto *f136
				if %answer_point<10 goto *f137
				inc %flg_quiz${i}
				goto *f136`)))
		}
	}
	{ // insert block ends for ciel_teacher scenes and yume07 scenes
		for (const lbl of ['s544', 's545', 's546', 's548', 's549', 's550',
						   's551', 's552', 's553', 's554', 's555', 's556']) {
			const blockName = `${lbl}_end`
			blocks.set(blockName, new Block(blockName, parseScript(`
				*${blockName}
				goto *endofplay`)))
		}

	}

	//sort block again
	const entries = [...blocks.entries()].sort(([_1, b1], [_2, b2])=>b1.firstLineIndex - b2.firstLineIndex)
	blocks.clear()
	for (const [label, block] of entries) {
		blocks.set(label, block)
	}
}

//#endregion ###################################################################
//#region                       SIDE GENERATIONS
//##############################################################################

const destinationRegex = /^((\[[^\]]+\])|(\([^\]]+\)))?\*(?<target>\w+)$/ // [...]*X | (...)*X | *X

function extractDestinations(token: Token) {
	if (token instanceof ConditionToken)
		token = token.command
	if (!(token instanceof CommandToken))
		return []
	return token.args.map((a: string)=> {
		return a.match(destinationRegex)?.groups!.target ?? null
	}).filter(a=>a != null)
}

function genTree(blocks: Map<string, Block>) {
	//1. extract block children links
	const tree = new Map(Array.from(blocks.entries()).map(([label, block], i)=> {
		const children = block.tokens.flatMap(extractDestinations)
		const scenes = children.filter(lbl=>isSceneLabel(lbl))
		const others = [...new Set(children.filter(lbl=>!scenes.includes(lbl) && lbl != 'endofplay')).values()]
		return [label, {scenes, children: new Set(others), parents: new Set<string>(), index: -1}]
	}))
	//2. add link to parent
	for (const [label, {children}] of tree.entries()) {
		for (const child of children) {
			if (!tree.has(child))
				debugger;
			tree.get(child)!.parents.add(label)
		}
	}
	//3. move links before scenes to parent nodes, link to skip nodes
	for (const [label, {scenes, children, parents}] of tree.entries()) {
		if (scenes.length > 0) {
			if (children.size > 0) {
				if (parents.size == 0)
					throw Error(`link before scenes ${scenes}, but no parent`)
				for (const parent of parents) {
					const parentNode = tree.get(parent)!
					for (const child of children)
						parentNode.children.add(child)
					// link from parent to scene is kept
				}
				for (const child of children) {
					const childNode = tree.get(child)!
					for (const parent of parents)
						childNode.parents.add(parent)
					childNode.parents.delete(label) // delete link from scene to child (might be restored in skip)
				}
				children.clear()
			}
			let endLabel = `${scenes[0]}_end`
			
			const endNode = tree.get(endLabel)
			if (!endNode)
				throw Error(`missing ${endLabel} for scenes ${scenes}`)
			endNode.parents.add(label)
			children.add(endLabel)
		}
	}
	//4. bypass non-scene blocks
	for (const [label, {scenes, parents, children}] of tree.entries()) {
		if (scenes.length == 0) {
			for (const child of children) {
				const childNode = tree.get(child)!
				for (const parent of parents)
					childNode.parents.add(parent)
			}
			for (const parent of parents) {
				const parentNode = tree.get(parent)!
				for (const child of children)
					parentNode.children.add(child)
			}
			for (const parent of parents)
				tree.get(parent)!.children.delete(label)
			for (const child of children)
				tree.get(child)!.parents.delete(label)
		}
	}
	const roots = ['f520',
		...[1,2,3,4,5].map(n=>`ciel_teacher_${n}`),
		...[1,2,3,4,5,6,7,8,9,10].map(n=>`yume${n.toString().padStart(2,'0')}`),
		...['ark', 'ciel', 'akiha', 'hisui', 'kohaku'].map(x=>`summer_${x}`),
		'yoiyumetsuki',
	].map(lbl=>tree.get(lbl)!)
	roots.forEach(node=> { node.index = 0 })



	//5. determine order index, easier for creating contexts when parsing scenes
	const queue = [...roots]
	while (queue.length > 0) {
		const currentNode = queue.shift()!
		for (const child of currentNode.children) {
			const node = tree.get(child)!
			if (node.index >= 0) continue
			let index = -1
			for (const parent of node.parents) {
				const parentNode = tree.get(parent)!
				if (parentNode.index < 0) {
					index = -1
					break
				} else {
					index = Math.max(index, parentNode.index)
				}
			}
			if (index >= 0) {
				node.index = index+1
				queue.push(node)
			}
		}
	}
	//6. filter and sort labels
	const sceneNodes = Array.from(tree.values()).filter(({scenes})=>scenes.length > 0)
		 .sort(({index: i1}, {index: i2})=>i1 - i2)

	return sceneNodes.map(({scenes, parents, children, index})=> {
		if (index < 0) throw Error(`node of ${scenes} was not assigned an index`)
		const pStr = Array.from(parents.values(), l=>tree.get(l)!.scenes).flat().sort().join(',')
		const cStr = Array.from(children.values(), l=>tree.get(l)!.scenes).flat().sort().join(',')
		return scenes.map(s=>`${s}:${pStr}|${cStr}`)
	}).flat().join('\n')
}

function extractChoices(blocks: Map<string, Block>) {
	return Object.fromEntries(Array.from(blocks.entries(), ([label, block])=> {
		const selects = block.filter(t => t instanceof CommandToken && t.cmd == 'select') as CommandToken[]
		if (selects.length == 0)
			return null
		if (selects.length > 1)
			throw Error(`multiple 'select' in label ${label}`)
		const [select] = selects
		const args = select.args

		// Labels may also contain disable or hide conditions
		const isText = (a: string)=> !['*', '(', '['].includes(a.charAt(0))

		const texts = args.filter(isText).map(txt => {
			const startChar = txt.charAt(0)
			if (startChar == '`')
				txt = txt.substring(1, txt.length-1)
			return txt
		})
		const labels = args.filter(a => !isText(a))
		select.args = labels
		return [label.replace('_end', ''), texts]
	}).filter(x=>x != null))
}


//#endregion ###################################################################
//#region                             MAIN
//##############################################################################

/**
 * @returns blocks tree, choice texts, logic script
 */
function processSingleScript(folder: string, filename: string): [string, Record<string, string[]>, string] {
	const fullscriptPath = path.join(outputPathPrefix, folder, 'sources', filename)

	if (!fs.existsSync(fullscriptPath)) {
		const errMsg = `Input file not found: ${fullscriptPath}`
		logger.error(errMsg)
		throw Error(errMsg)
	}

	let txt = fs.readFileSync(fullscriptPath, 'utf-8')
				.replaceAll('\n\t', '\n')
				.replaceAll(/^select\s*(\r?\n([`"][^`"]*[`"],\s*\*\w+,\s*\r?\n)*([`"][^`"]*[`"],\s*\*\w+))$/gm, (m)=> m.replaceAll(/\r?\n/g, ' '))
	const { kt_raw_fixes, block_fixes = {} } = loadLangPreprocess(folder)
	txt = kt_raw_fixes?.(txt) || txt
	const tokens = parseScript(txt)
	const blocks = splitBlocks(tokens, getBlockProps.bind(undefined,
		new Map(Object.entries(block_fixes))
	))
	interBlockFixes(blocks)
	const tree = genTree(blocks)
	const choices = extractChoices(blocks)
	const fileContents = generateScenes(blocks, ()=>LOGIC_FILE)

	return [tree, choices, fileContents.get(LOGIC_FILE)!]
}

export function main() {
	const totalScripts = fullscripts.length
	let logicScript = null
	let blocksTree = null

	let processedCount = 0
	for (const [folder, filename] of fullscripts) {
		processedCount++
		logger.progress(`Processing logic scripts: ${processedCount}/${totalScripts} (${filename})`)

		try {
			//1. Extract blocks tree, choice texts and logic script
			const [tree, choices, logicContent] = processSingleScript(folder, filename)

			//2. Compare blocks tree and logic script with previous languages
			if (blocksTree == null && logicScript == null)
				[blocksTree, logicScript] = [tree, logicContent]
			else if (logicScript != logicContent || blocksTree != tree)
				throw Error(`logic script from language ${folder} does not match previous languages`)

			//3. Update language game.json with choice texts
			if (GEN_CHOICES_JSON) {
				const gameJsonPath = path.join(outputPathPrefix, folder, 'game.json')
				updateGameJsonWithChoices(gameJsonPath, choices)
			}
		} catch (e) {
			logger.error(`Error processing ${filename}: ${(e as Error).message}`)
			throw e
		}
	}
	logger.progress(`Processing logic scripts: ${processedCount}/${totalScripts}\n`)

	//4. Save logic script file and blocks tree
	if (GEN_LOGIC) {
		const centralLogicPath = path.join(outputPathPrefix, LOGIC_FILE + '.txt')
		const dir = path.dirname(centralLogicPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(centralLogicPath, logicScript!)
	}
	if (GEN_TREE) {
		fs.writeFileSync(path.join('.', "logic_tree.txt"), blocksTree!)
	}
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
	main()
}
export { LOGIC_FILE }
