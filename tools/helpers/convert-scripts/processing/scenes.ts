/**
 * Convert a script file into a folder of scenes in the format
 * used by the parser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'
import { parseScript } from '@tsukiweb/common/tools/convert-scripts/parsers/nscriptr.ts';
import { Block, CommandToken, ConditionToken, LabelToken, ReturnToken, TextToken, Token } from '@tsukiweb/common/tools/convert-scripts/parsers/utils.ts'
import { generateScenes, splitBlocks, writeScenes } from '../utils/nscriptr_convert.ts';
import { logger } from '@tsukiweb/common/tools/utils/logger.ts';
import { fixContexts } from '../utils/context.ts';
import { processVarName, isSceneLabel, preprocessRawScript } from './common.ts';
import { isCmd, processCondition } from '@tsukiweb/common/tools/convert-scripts/utils.ts';
import { fullscripts, loadLangPreprocess, outputPathPrefix } from './fullscripts.ts';

const outputDir = 'scenes'
const limitScenes: string[] = [
	//'s533'
]

//#endregion ###################################################################
//#region                             FIXES
//##############################################################################


//_________________________________token fixes__________________________________
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

const COLOR_IMAGES = new Map(Object.entries({
	'"bg/ima_10"' : '#000000',
	'"bg/ima_11"' : '#ffffff',
	'"bg/ima_11b"': '#9c0120',
}))

function commandFix(token: Token) {
	if (!(token instanceof CommandToken))
		return
	switch (token.cmd) {
		case 'bg' :
			if (COLOR_IMAGES.has(token.args[0]))
				token.args[0] = COLOR_IMAGES.get(token.args[0])!
			break
		case 'mov' :
		case 'inc' :
			token.args[0] = processVarName(token.args[0])!
			if (!token.args[0])
				return false
			break
		case 'gosub' :
		case 'goto' :
			switch (token.args[0]) {
				case "*set_window_mm" : return false // TODO see effect in original game.
				case "*set_window" : return false
				case "*reset_window" : return false
				case "*eroskipeffect" : return false
				default :
					if (/^\*s\d+eroend$/.test(token.args[0]))
						return false
				throw Error(`Unknown gosub target ${token.args[0]}`)
			}
		case 'wave' : case 'waveloop' :
			const m = token.args[0].match(/^"?se(?<n>\d+)"?$/)
			if (m) {
				// se1 -> se_01
				token.args[0] = `se_${String(+m.groups!.n).padStart(2, '0')}`
			} else {
				throw Error(`Unexpected wave id ${token.args[0]}`)
			}
			break
		case 'vsp' :
			if (token.args[1] == '0')
				return false // sprite removed automatically
			token.cmd = 'ld'
			let img
			switch(token.args[0]) {
				case '0' : img = '":a;image\\tachi\\his_nt05a.jpg"'; break
				case '1' : img = '":a;image\\tachi\\his_nt05b.jpg"'; break
				case '2' : img = '":a;image\\tachi\\his_nt05c.jpg"'; break
				case '3' : img = '":a;image\\tachi\\his_nt05d.jpg"'; break
				default : throw Error(
					`Unexpected argument value '${token.args[0]}'for vsp`)
			}
			token.args = ['c', img, 'crossfade_fastest']
			break
	}
}

function merge_images(token: Token, bottom: string, top: string, replace: string) {
	if ((token instanceof CommandToken) && token.cmd == 'bg') {
		const img = token.args[0]
		if (img.includes(bottom)) {
			token.args[0] = img.replace(bottom, replace)
			token.args.push('bottom')
			return true
		} else if (img.includes(top)) {
			token.args[0] = img.replace(top, replace)
			token.args.push('top')
			return true
		}
	}
	return false
}

const tokenFixes = new Map(Object.entries({
	's159': (token: Token)=> {
		merge_images(token, 'yume_e12b', 'yume_e12a', 'yume_e12')
	},
	's530': (token: Token)=> {
		merge_images(token, 'yume_e12b', 'yume_e12a', 'yume_e12')
	},
}))

//_________________________________scene fixes__________________________________
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// index of the text right before the next page break
const pageEnd = (b: Block, from = 0, ignore = 0) =>
	b.findIndex(t=>isCmd(t, '\\'), from, ignore)-1
// index of the text right before the previous page break
const prevPageEnd = (b: Block, before: number, ignore = 0) =>
	b.findLastIndex(t=>isCmd(t, '\\'), before, ignore)-1

const centerTexts: Record<string, (b: Block)=>number[]> = {
	s1  : b => [b.findIndex((t,i)=>isCmd(t, '\\') && b.at(i-1) instanceof TextToken)-1],
	s36 : b => [b.findLastIndex(t=>isCmd(t, 'br'))+2],
	s37 : b => [b.findIndex(t=>isCmd(t, 'bg', /ren_e05/))-3],
	s40 : b => [b.findIndex(t=>isCmd(t, 'play', '"*5"'))-2],
	s57 : b => [b.findIndex(t=>isCmd(t, 'play', '"*14"'))-3],
	s76 : b => {
		const i = b.findIndex(t=>isCmd(t, 'bg', /yume_e06/))
		const j = b.findIndex((t,j)=>j>i && t instanceof TextToken)
		const k = b.findIndex((t,k)=>k>j && isCmd(t, 'bg', /ima_13b/, /crossfade/))
		const l = b.findIndex((t,l)=>l>k && t instanceof TextToken)
		return [i-3, i-2, j, k-2, l]
	},
	s80 : b => [b.findIndex(t=>isCmd(t, '!w'))-2,
			//b.findIndex(t=>isCmd(t, 'play', '"*15"'))
			],
	s83 : b => [pageEnd(b)],
	s116: b=> {
		const indices = Array.from(b)
			.filter(([t,_])=>isCmd(t, 'textcolor', '#ff0000'))
			.map(([_,i])=>i+1)
		indices.push(b.findLastIndex(t=>isCmd(t, 'play'))-4)
		return indices
	},
	s133: b=> { // identical to s116
		const indices = Array.from(b)
			.filter(([t,_])=>isCmd(t, 'textcolor', '#ff0000'))
			.map(([_,i])=>i+1)
		indices.push(b.findLastIndex(t=>isCmd(t, 'play'))-4)
		return indices
	},
	s139: b=> [b.findIndex(t=>isCmd(t, 'bg', /ima_23/))-3],
	s151: b=> [b.findIndex(t=>isCmd(t, 'bg', /ima_23/))-3],
	s185: b=> [b.findLastIndex((t,i)=>isCmd(t,'br') && b.at(i+1) instanceof TextToken)+2],
	s191: b=> [b.findLastIndex(t=>isCmd(t, 'play', '"*6"'))-2],
	s187: b=> [b.findLastIndex(t=>isCmd(t, 'play', '"*6"'))-2],
	s237: b=> {
		const indices = [b.findIndex(t=>isCmd(t, 'wave', 'se_39'))-2]
		//indices.push(b.findIndex(t=>isCmd(t, 'bg', /ima_22/), 0, 7)-1)
		const i = b.findIndex(t=>isCmd(t, 'playstop'))
		const j = b.findLastIndex(t=>t instanceof TextToken, i, 1)
		indices.push(j)
		indices.push(i-2)
		return indices
	},
	s305: b=> {
		let i = b.findIndex(t=>isCmd(t, 'play', '"*16"'), 0, 1)
		i = prevPageEnd(b, b.findIndex(t=>isCmd(t, 'play', '"*5"'), i))
		const indices = [i-1, i]
		i = b.findLastIndex(t=>isCmd(t, 'waveloop'))
		i = b.findIndex(t=> t instanceof TextToken, i, 1)
		indices.push(i)
		return indices
	},
	s306: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, 'waveloop', 'se_25')))],
	s307: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, 'ld', 'c', /ren_t01/, 'crossfade', '400')))],
	s308: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, 'ld', 'c', /ren_t01/, 'crossfade', '400')))],
	s403: b=> [pageEnd(b)],
	s404: b=> [pageEnd(b)],
	s510: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, 'bg', '#000000', 'crossfade', '1500')))],
	s521: b=> [prevPageEnd(b, b.findIndex(t=>isCmd(t, 'bg', '#ffffff')))],
	s523: b=> [pageEnd(b)],
	s530: b=> {
		const i = b.findIndex(t=>isCmd(t, 'bg', /ima_30b/))
		const indices = [b.findLastIndex(t=>isCmd(t, '!w'), i)-1]
		// the page can have 2 or 3 lines depending on the language
		const j = pageEnd(b, i)
		for (let k = b.findLastIndex(t=>isCmd(t, 'br'), j)+1; k <= j; k++)
			indices.push(k)
		return indices
	},
	s531: b=> {
		const i = b.findIndex(t=>isCmd(t, 'bg', /kishin_04/))
		const j = b.findIndex(t=>isCmd(t, 'wavestop'), i)
		const k = b.findIndex(t=>isCmd(t, 'bg', /ima_02/), j)
		//const l = prevPageEnd(b, b.findLastIndex(t=>isCmd(t, 'playstop')))
		return [
			pageEnd(b, b.findIndex(t=>isCmd(t, 'bg', /ima_02/))),
			prevPageEnd(b, b.findIndex(t=>isCmd(t, 'bg', /cmo_19/))),
			pageEnd(b, i),
			prevPageEnd(b, j),
			b.findIndex(t=>isCmd(t, 'br'), k)+2,
			//b.findLastIndex(t=>t instanceof TextToken, l), l
		]
	},
	s533: b=> {
		const i = b.findIndex(t=>isCmd(t, 'textcolor', '#ff0000'))
		const j = b.findIndex(t=>isCmd(t, 'textcolor', '#ff0000'), i+1)
		const k = b.findIndex(t=>isCmd(t, 'wave', 'se_38'), j)
		return [pageEnd(b, i), pageEnd(b, j), pageEnd(b, k)]
	},
	s537: b=> {
		const i = prevPageEnd(b, b.findIndex(t=>isCmd(t, 'bg', /bg_31b/, 'crossfade', '400')))
		const j = prevPageEnd(b, b.findIndex(t=>isCmd(t, 'waveloop', 'se_25'), i))
		let k = b.findIndex(t=>isCmd(t, 'play', '"*16"'))
		k = prevPageEnd(b, b.findIndex(t=>isCmd(t, 'bg', '#000000', 'crossfade', '800'), k))
		let l = b.findIndex(t=>isCmd(t, 'bg', /cmo_19/, 'notrans'))
		l = pageEnd(b, b.findIndex(t=>isCmd(t, '!w', '4000'), l, 1))
		return [i, j, k, l]
	},
	s540: b=> {
		let i = b.findIndex(t=>isCmd(t, 'waveloop', 'se_40'))
		i = b.findIndex(t=>isCmd(t, '\\'), i, 3)
		return [b.findLastIndex(t=>isCmd(t, 'br'), i)-1]
	},
	s545: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, '!w', '5000')))],
	s546: b=> {
		let i = b.findIndex(t=>isCmd(t, 'bg', /bg_40a/))
		i = b.findIndex(t=>isCmd(t, 'playstop'), i)
		return [b.findLastIndex(t=>isCmd(t, 'br'), i)-1]
	},
}
const rightAlignTexts: Record<string, (b:Block)=>number[]> = {
	s37: b => [b.findIndex(t=>isCmd(t, 'bg', /ren_e05/))-2],
	s40: b => [b.findIndex(t=>isCmd(t, 'wave', 'se_31'))+3],
	s244: b=> [pageEnd(b, b.findIndex((t,i)=>isCmd(t, 'br') && isCmd(b.at(i+1)!, 'br')))],
	s305: b=> [
		b.findIndex(t=>isCmd(t, 'textcolor', '#ff0000'))+1,
		b.findIndex(t=>isCmd(t, 'play', '"*16"'), 0, 1)-3
	],
	s529: b=> [pageEnd(b, b.findIndex(t=>isCmd(t, 'bg', /bg_72d/)), 1)],
	s537: b=> {
		const i = b.findIndex(t=>isCmd(t, 'play', '"*16"'))
		let j = b.findIndex(t=>isCmd(t, 'bg', /bg_94/, 'lcartain'))
		j = b.findIndex(t=>isCmd(t, 'playstop'), j)
		j = b.findLastIndex(t=>isCmd(t, '\\'), j, 1)
		return [b.findIndex(t=>t instanceof TextToken, i), j-2, j-1]
	},
}

function align(block: Block) {
	if (block.name in centerTexts) {
		const indices = centerTexts[block.name](block)
		for (const i of indices) {
			const t = block.at(i)
			if (t instanceof TextToken)
				t.text = '[center]' + t.text.trim()
			else
				throw Error(`Expected text for alignement in ${block.name}, got ${t}`)
		}
	}
	if (block.name in rightAlignTexts) {
		const indices = rightAlignTexts[block.name](block)
		for (const i of indices) {
			const t = block.at(i)
			if (t instanceof TextToken)
				t.text = '[right]' + t.text.trim()
			else
				throw Error(`Expected text for alignement in ${block.name}, got ${t}`)
		}
	}
}

const blockFixes = new Map(Object.entries({
	s89: (block: Block)=> {
		let t = block.find(
			t=>t instanceof TextToken && t.text.includes('Bourdeaux')
		) as TextToken|undefined
		if (t) {
			t.text = t.text.replace("Bourdeaux", "Bordeaux")
						   .replace("Pouligny", "Puligny")
		}
	},
	s530: (block: Block)=> {
		processJumps(block)
		const i = block.findIndex(t=>isCmd(t, "mov", "%2100", "0"))
		if (i < 0) throw Error(`Expected 'mov %2100,0' in s530`)
		const j = block.findIndex(t=>isCmd(t, "bg"), i+1)
		const token = block.at(j) as CommandToken<"bg">
		block.delete(i, j-i)
		token.args[1] = "bscroll"
		token.args[2] = (32*480).toString()
	},
	s532: (block: Block)=> {
		let t = block.find(
			t=>t instanceof TextToken && t.text.includes('Arihikio')
		) as TextToken|undefined
		if (t) t.text = t.text.replace("Arihikio", "Arihiko")
		t = block.find(
			t=>t instanceof TextToken && t.text.includes('Ichigo (一子)')
		) as TextToken|undefined
		if (t) t.text = t.text.replace("Ichigo (", "Ichiko (")
	},
	s533: (block: Block)=> {
		processJumps(block)
		const i = block.findIndex(t=>isCmd(t, 'lsp'))
		const tok = block.at(i)! as CommandToken
		tok.cmd = 'ld'
		tok.args = ['c', tok.args[1], (block.at(i+1)! as CommandToken).args[1]]
		block.delete(i+1) // delete 'cl c,crossfade_slw' that follow lsp
		const bg = block.find((t, j)=> j > i && isCmd(t, 'bg')) as CommandToken
		bg.cmd = 'ld'
		bg.args = ['bg', ...bg.args]
		// TODO Exceptionally, during bg change, center sprite should remain
	},
}))

function quizFix(block: Block, blocks: Map<string, Block>) {
	for (let i=1; i <= 10; i++) {
		const b = blocks.get(`${block.name}_${i}`)
		if (b) {
			block.extend(b)
			blocks.delete(b.name)
		}
	}
	block.insert(0, `mov %answer_point,0`)
	for (const [token, i] of block) {
		if (isCmd(token, 'select')) {
			(token as CommandToken).cmd = 'prompt'
			let j = i-1
			let textToken = undefined
			while (j > 0 && !((textToken = block.at(j)) instanceof TextToken)) {
				if (!(textToken instanceof CommandToken))
					throw Error(`Unexpected token ${textToken} before question in ${block.name}`)
				if (['br', '\\'].includes(textToken.cmd))
					block.delete(j)
				else {
					throw Error(
						`Unexpected command ${textToken} before quiz in ${block.name}`)
				}
				j--
			}
			if (!(textToken instanceof TextToken))
				throw Error(`${block.name} question not preceded by Text token`)
			block.delete(j)
			token.args.unshift('%answer', `\`${textToken.text.replaceAll('@', '')}\``)
			let m
			for (let k = 0; k < token.args.length; k++) {
				if (m = token.args[k].match(/^\*quiz\d_\d+(true|false)$/))
					token.args[k] = m[1] == 'false' ? '0' : '1'
			}
			// insert a page break before the prompt, remove br
			for (let i = block.indexOf(token); i >= 0; i--) {
				const tok = block.at(i)
				if (tok instanceof TextToken) {
					if (tok.text.endsWith('@'))
						tok.text = tok.text.substring(0, tok.text.length-1)
					block.insert(i+1, '\\')
					break
				} else if (tok instanceof CommandToken) {
					if (tok.cmd == '\\')
						break
					if (tok.cmd == 'br')
						block.delete(i)
				}
			}
			//block.insert(block.indexOf(token), '\\')
			block.insert(block.indexOf(token)+1, `add %answer_point,%answer`)
		}
	}
}
// 1. Put '\' after last text of scenes (fix text skip before choices)
// and selects outside logic file. Remove '@' if present and trailing 'br'.
function cleanSceneEnd(block: Block) {
	let stop = false
	for (let i = block.length-1; i>= 0 && !stop; i--) {
		const token = block.at(i)
		if (token instanceof CommandToken) {
			switch (token.cmd) {
				case 'br':
					block.delete(i) // remove line breaks after last text
					break
				case 'ld'  : case 'bg': case 'cl':
				case 'wait': case '!w':
					stop = true
					break
				case '\\' : case '@' :
					token.cmd = '\\' // convert '@' to '\\'
					stop = true
					break
			}
			if (stop)
				break
		} else if (token instanceof TextToken) {
			if (token.text.endsWith('@'))
				token.text = token.text.substring(0, token.text.length-1)
			block.insert(i+1, new CommandToken(token.lineIndex, '\\'))
			break
		}
	}
}

function processJumps(block: Block) {
	for (let [t, i] of block) {
		if (t instanceof ConditionToken)
			t = t.command
		if (isCmd(t, 'jumpb')) {
			const j = block.lastIndexOf('~', i)
			if (j < 0) throw Error(`Unexpected 'jumpb' without '~'`)
			;(t as CommandToken).cmd = 'skip'
			t.args = [(block.at(j)!.lineIndex - t.lineIndex).toString()]
			block.delete(j) // assume only one '~' per jump
		}
	}
}

function sceneFixes(block: Block) {
	//remove '@' before '\\'
	const skipStart = block.findIndex(t=>t instanceof ConditionToken && t.condition.startsWith('%sceneskip'))
	if (skipStart >= 0) {
		const skip = block.at(skipStart+1)
		if (skip instanceof CommandToken && skip.cmd == 'skip') {
			const skipLength = parseInt(skip.args[0])
			const skipEnd = block.findIndex(t=>t.lineIndex >= skip.lineIndex + skipLength)
			block.delete(skipStart, skipEnd-skipStart)
		} else {
			block.delete(skipStart, 1)
		}
	}
	for (const [token, i] of block) {
		if (token instanceof CommandToken && token.cmd == '\\') {
			const prev = block.at(i-1)
			if (prev instanceof TextToken && prev.text.endsWith('@'))
				prev.text = prev.text.substring(0, prev.text.length-1)
		}
	}
	cleanSceneEnd(block)
}

function eroskip_fixes(pages: ([number, number]|[number]|number)[], block: Block) {
	const pageIndices = [-1] // -1 to insert eroskip at the start if necessary
	for (const [token, i] of block) {
		if (token instanceof CommandToken && token.cmd == '\\')
			pageIndices.push(i)
	}
	for (const entry of pages.reverse()) {
		let start, end;
		if (typeof entry == 'number') {
			start = entry
			end = pageIndices.length
		} else if (entry.length == 1) {
			start = entry[0]
			end = pageIndices.length
		} else {
			[start, end] = entry
		}
		block.insert(pageIndices[start]+1, `eroskip ${+end - start}`);
	}
}

function interScenesFixes(blocks: Map<string, Block>) {
	
	// Merge scene sX with seX
	const sceneEnds = blocks.values().filter(b=>/^se\d+$/.test(b.name))
	for (const block of sceneEnds) {
		blocks.get(`s${block.name.substring(2)}`)?.extend(block)
		block.delete(0, block.length)
		blocks.delete(block.name)
	}
	// Merge quizX_Y into quizX
	for (let i=1; i <= 3; i++) {
		const quiz = blocks.get(`quiz${i}`)!
		quizFix(quiz, blocks)
	}
	// s400, s401 and s402 are identical. Conditions are moved to choice after
	// s400 end has additional delay and line break, keeping s401
	blocks.delete('s400')
	blocks.delete('s402')
	blocks.delete('s42')
}

//#endregion ###################################################################
//#region                            MAIN
//##############################################################################

const kept_commands = [
	'play', 'playstop', 'wave', 'waveloop', 'wavestop', 'mp3loop', 'stop', // audio
	'bg', 'ld', 'cl','quakex', 'quakey', 'monocro', // graphics
	'if', 'skip', // in-scene movements
	'jumpb', '~', // replaced with skip
	'gosub', // used for phase transitions
	'@', '\\', 'click', 'br', 'textcolor', // text commands, wait click
	'!w', 'wait', 'waittimer', 'delay', // delay
	'mov', 'add', 'sub', 'inc', 'dec', // set variables
	'lsp', 'vsp', // replaced with ld
	'select', // used for quiz, to be replaced with special command
]
// TODO: selgosub commands should be removed. They are only useful in KT
// in some contexts (7 occurrences), for which a solution must be found

const ignored_commands = [
	'setwindow', 'windoweffect',
	'setcursor', 'autoclick',
	'selnum',
	'!s', '!sd',
	'resettimer',
	'goto', 'osiete', 'return', 'selgosub', //logic-only commands
	'saveon', 'saveoff', // (en/dis)able saving to improve perf. on NScr engine. Useless here
	'btndef', 'blt', // used in s530, whole section replaced with scrolling background
	'csp', // useless: needs 'print' to work, but always immediately followed by bg
	'print', // preceeding vsp replaced by ld
	'lsph', // sprite statically replaced in vsp
	'jumpf', // only used in menus
]
const deleted_scenes = [
	's42', // -> s43
	's68', 's69', 's70', 's71', // -> s248
	's155', // -> s156
	's206', // -> s202
	's218', // -> s214
	's245', 's246', 's247', // -> f248
	's400', 's402', // -> s401
]

function token_filter(token: Token) {
	if (token == null) return false
	if (token instanceof ReturnToken) return false
	if (token instanceof TextToken  ) return true
	if (token instanceof LabelToken) return false
	if (token instanceof ConditionToken) {
		token.condition = processCondition(token.condition, processVarName)!
		if (!token.condition) return false
		return true
	}
	if (token instanceof CommandToken) {
		if (   kept_commands.includes(token.cmd)) return true
		if (ignored_commands.includes(token.cmd)) return false
		throw Error(`unrecognized command ${token.cmd} (line ${token.lineIndex})`)
	}
	throw Error(`Unrecognized token type of ${token}`)
}

function getBlockProps(
		lang_block_fixes: Map<string, (block: Block)=>void>,
		eroskip_pages: Map<string, ([number, number]|[number]|number)[]>,
		label: string) {
	if (!isSceneLabel(label)) {
		return null // logic blocks handled in separate script
	}
	if (deleted_scenes.includes(label)) {
		return null
	}
	const token_fixes = [ token_filter, commandFix ] as Array<(t: Token)=>void|boolean>
	const block_fixes = [ align, sceneFixes ] as Array<(block: Block)=>void>
	if (tokenFixes.has(label))
		token_fixes.push(tokenFixes.get(label)!)
	if (blockFixes.has(label))
		block_fixes.push(blockFixes.get(label)!)
	if (lang_block_fixes.has(label))
		block_fixes.push(lang_block_fixes.get(label)!)
	if (eroskip_pages.has(label))
		block_fixes.push(eroskip_fixes.bind(undefined, eroskip_pages.get(label)!))
	
	return {
		tokenFixes: token_fixes,
		blockFixes: block_fixes
	}
}
function getFileName(label: string) {
	if (/^s\d+?$/.test(label))
		return `s${label.substring(1).padStart(3, '0')}`
	if (['quiz1', 'quiz2', 'quiz3'].includes(label))
		return label
	
	throw Error(`Unexpected label ${label}`)
}


function processSingleScript(folder: string, filename: string,
		outputDir: string|null,
		blocksTree: Map<string, {parents: string[], children: string[], endContext: object|null}>) {
	const fullscriptPath = path.join(outputPathPrefix, folder, 'sources', filename)

	if (!fs.existsSync(fullscriptPath)) {
		logger.error(`Input file not found: ${fullscriptPath}`)
		return null
	}

	let txt = fs.readFileSync(fullscriptPath, 'utf-8')
				.replaceAll('\n\t', '\n')
				.replaceAll(/^select\s*(\r?\n([`"][^`"]*[`"],\s*\*\w+,\s*\r?\n)*([`"][^`"]*[`"],\s*\*\w+))$/gm, (m)=> m.replaceAll(/\r?\n/g, ' '))
	txt = preprocessRawScript(txt)
	const { kt_raw_fixes, eroskip_pages = {}, block_fixes = {} } = loadLangPreprocess(folder)
	txt = kt_raw_fixes?.(txt) || txt
	const tokens = parseScript(txt)
	
	let blocks = splitBlocks(tokens, getBlockProps.bind(undefined,
		new Map(Object.entries(block_fixes)),
		new Map(Object.entries(eroskip_pages))
	))
	interScenesFixes(blocks)
	fixContexts(blocksTree, blocks)
	if (limitScenes.length > 0) { 
		blocks = new Map(blocks.entries().filter(([name, _])=>limitScenes.includes(name)))
	}
	const fileContents = generateScenes(blocks, getFileName)

	const outputPath = outputDir
		? path.join(outputPathPrefix, folder, outputDir)
		: null

	if (outputPath) {
		const scenesList = new Map(fileContents)
		writeScenes(outputPath, scenesList)
	}
}


export function main() {

	//1. Retrieve scenes tree
	const treeFilePath = path.join('.', "logic_tree.txt")
	if (!fs.existsSync(treeFilePath))
		throw Error(`Missing tree file. Extract logic first`)
	const treeFileContent = fs.readFileSync(treeFilePath, 'utf-8')
	const tree = new Map(treeFileContent.split('\n').map(line=> {
		line = line.trim()
		if (line.length == 0)
			return null
		const match = line.trim().match(/^(\w+):([^|]*)\|(.*)$/)
		if (!match)
			throw Error(`unable to parse line ${line} from tree file`)
		return [ match[1] as string, {
			parents: match[2].split(',').filter(x=>x) as string[],
			children: match[3].split(',').filter(x=>x) as string[],
			endContext: null as null|object}
		] as const
	}).filter(x=>x != null))

	//2. Extract scenes, fix start contexts
	const totalScripts = fullscripts.length
	let processedCount = 0
	for (const [folder, filename] of fullscripts) {
		processedCount++
		logger.progress(`Processing fullscripts: ${processedCount}/${totalScripts} (${filename})`)
		try {
			processSingleScript(folder, filename, outputDir, tree)
		} catch (e) {
			logger.error(`Error processing ${filename}: ${(e as Error).message}`)
		}
	}
	logger.progress(`Processing fullscripts: ${processedCount}/${totalScripts}\n`)
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
	main()
}
