import { DY, FcOverlayDrawer, POINT_HEAD_CLIP, StyleReader, detailsVisibility, disc, drawHead,
	getHeadImage, headClip, path2D } from "@tsukiweb/common/flowchart"
import { FLAG_BACKGROUND, FLAG_CONTENT, POINT_BACKGROUND, POINT_RADIUS, POINT_SIGN, STRIKE_COLOR }
	from "@tsukiweb/common/icons/badges"
import { PointId } from "app/utils/types"
import { BADGE_PATHS, HOURGLASS, QUIZ_ICON, QUIZ_NUMBER_X, flagPersists, pointPersists } from "../components/badges"
import { getNodeBadges } from "./badges"
import { FcNode, GameFlowchart } from "./flowchart"


type BadgeFill = 'background' | PointId | (string & {})

type BadgeIcon = { text: string } | { icon: string } | { head: PointId } | { dots: true }

type BadgeLayout = { x: number, y: number } & (
	| { type: 'regard', char: PointId, value: number }
	| { type: 'point', id: string }
	| { type: 'flag', flag: string }
	| { type: 'quiz', n: number }
	| { type: 'select', link: string, n?: number }
	| { type: 'condition', angle: number, iconX: number, iconY: number,
		icon: BadgeIcon, fill: BadgeFill, negative: boolean }
)

type Condition = NonNullable<NonNullable<ReturnType<typeof getNodeBadges>>['condition']>

type BBox = [left: number, top: number, right: number, bottom: number]

const REGARD_REGEX = /^%(\w+)_point/
const BADGE_RIGHT_INSET = 3
const FLAG_RIGHT_INSET = 3.5
const FLAG_SPACING = DY * 2.6
const SHADOW_OFFSET = 0.4
const ICON_POINTS = ["kagi", "kaibyo"]
const COND_UNIT = DY * 0.8
const TEXT_SIZE = 4
const DOTS_RADIUS = 0.4
const DOTS_GAP = 1.2
const POINT_SPACING = 7
const COND_HEAD = { y: 0.3, radius: 2.7 }
const COND_HEAD_CLIP = headClip(disc(COND_HEAD.radius), COND_HEAD.radius)

const headSrc = (char: string) => `./res/chars/${char}.webp`


//##############################################################################
//#region                           LAYOUT
//##############################################################################

function conditionLayout(node: FcNode, condition: Condition): BadgeLayout {
	let x = node.centerX, y = node.top + 0.1
	let angle = 0, iconX = 0, iconY = DY*0.56
	if (typeof condition == 'object') {
		const { above, below } = condition
		const anchorNode = node.flowchart.getNode(above || below || node.id)!
		x = anchorNode.centerX
		y = above || !below ? anchorNode.top - DY : anchorNode.bottom + DY
		if (condition.align)
			y = node.flowchart.getNode(condition.align)!.top - DY
		const side = Math.sign(x - node.centerX)
		if (side != 0) {
			angle = side * 90
			iconX = -side * DY*0.1
			iconY = DY*0.48
			x -= side * (DY+0.1)
		} else {
			y += DY+0.1
		}
		condition = condition.icon || condition.condition
	}
	let negative = condition.startsWith('!')
	if (negative)
		condition = condition.substring(1)
	let icon: BadgeIcon = { dots: true }, fill: BadgeFill = 'background'
	const point = condition.match(REGARD_REGEX)?.[1]
	if (condition.includes('||') || condition.includes('&&')) {
		negative = false
	} else if (condition.startsWith('%flg')) {
		const flag = condition.substring(condition.startsWith('%flg_') ? 5 : 4)
		icon = flag.length > 1 ? { icon: flag } : { text: flag }
		fill = FLAG_BACKGROUND
	} else if (point && ICON_POINTS.includes(point)) {
		icon = { icon: point }
		fill = POINT_BACKGROUND
	} else if (point) {
		icon = { head: point as PointId }
		fill = point
	} else if (condition.startsWith('%quiz')) {
		icon = { icon: 'quiz' }
		fill = FLAG_BACKGROUND
	}
	return { type: 'condition', x, y, angle, iconX, iconY, icon, fill, negative }
}

/** Position and content of the badges of a node, in flowchart coordinates */
function getBadgesLayout(node: FcNode, flowchart: GameFlowchart): BadgeLayout[] {
	const badge = getNodeBadges(node.id)
	if (!badge) return []

	const { flags, char, value, select, condition } = badge
	const cornerX = node.right - (node.width > 0 ? BADGE_RIGHT_INSET : 0)
	const cornerY = node.bottom - (node.height > 0 ? DY / 2 : 0)
	const layouts: BadgeLayout[] = []

	if (char) {
		layouts.push(ICON_POINTS.includes(char)
			? { type: 'point', x: cornerX, y: cornerY, id: char }
			: { type: 'regard', x: cornerX, y: cornerY, char, value: value! })
	}
	const flagX = node.right - (node.width > 0 ? FLAG_RIGHT_INSET : 0)
	flags?.forEach((flag, i) => {
		const y = cornerY - (char ? i + 1 : i) * FLAG_SPACING
		layouts.push(flag.startsWith('quiz')
			? { type: 'quiz', x: flagX, y, n: parseInt(flag.at(-1)!) || 0 }
			: { type: 'flag', x: flagX, y, flag })
	})
	if (select) {
		const linkEnabled = node.children.some(child => !flowchart.isLinkDisabled(node, child))
		layouts.push({ type: 'select', x: node.centerX, y: node.bottom,
			link: linkEnabled ?
				`fc-link enabled${node.group ? ` group-${node.group}` : ''}`
				: "fc-link disabled",
			n: flowchart.getHistoryScene(node.id)?.choice ?? -1 })
	}
	if (condition)
		layouts.push(conditionLayout(node, condition))
	return layouts
}

//#endregion ###################################################################
//#region                           DRAWING
//##############################################################################

function fillStyle(ctx: CanvasRenderingContext2D, fill: BadgeFill, style: StyleReader, bbox: BBox) {
	if (fill == 'background')
		return style.color("var(--badge-background)")
	if (fill.startsWith('#'))
		return fill
	if (fill.startsWith('var('))
		return style.color(fill)

	let cache = gradientCache.get(style)
	if (!cache)
		gradientCache.set(style, cache = new Map())
	const key = `${fill}|${bbox.join()}`
	let gradient = cache.get(key)
	if (!gradient) {
		const [left, top, right, bottom] = bbox
		gradient = ctx.createLinearGradient(left, bottom, right, top)
		gradient.addColorStop(0, style.color(`color-mix(in oklch, var(--color-${fill}) 80%, white)`))
		gradient.addColorStop(1, style.color(`color-mix(in oklch, var(--color-${fill}) 80%, black)`))
		cache.set(key, gradient)
	}
	return gradient
}
const gradientCache = new WeakMap<StyleReader, Map<string, CanvasGradient>>()

function drawShape(ctx: CanvasRenderingContext2D, d: string, fill: string | CanvasGradient) {
	ctx.fillStyle = fill
	ctx.fill(path2D(d))
	ctx.strokeStyle = "white"
	ctx.lineWidth = 0.6
	ctx.stroke(path2D(d))
}

function drawIcon(ctx: CanvasRenderingContext2D, name: string) {
	const d = BADGE_PATHS.icons[name]
	if (!d)
		return
	ctx.fillStyle = "white"
	ctx.fill(path2D(d))
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
		font: string, color = "white", halo?: string) {
	ctx.font = `bold ${TEXT_SIZE}px ${font}`
	if (halo) {
		ctx.strokeStyle = halo
		ctx.lineWidth = 0.7
		ctx.strokeText(text, x, y)
	}
	ctx.fillStyle = color
	ctx.fillText(text, x, y)
}

function drawStrike(ctx: CanvasRenderingContext2D) {
	ctx.strokeStyle = STRIKE_COLOR
	ctx.lineWidth = 1
	ctx.stroke(path2D(BADGE_PATHS.strike))
}

/** Pennant, with its content drawn in the flag part */
function drawFlag(ctx: CanvasRenderingContext2D, fill: string, drawContent: VoidFunction) {
	ctx.fillStyle = "rgb(0 0 0 / 0.5)"
	ctx.translate(SHADOW_OFFSET, SHADOW_OFFSET)
	ctx.fill(path2D(BADGE_PATHS.flag))
	ctx.translate(-SHADOW_OFFSET, -SHADOW_OFFSET)
	ctx.strokeStyle = "white"
	ctx.lineWidth = 0.6
	ctx.stroke(path2D(BADGE_PATHS.flagPole))
	drawShape(ctx, BADGE_PATHS.flag, fill)
	ctx.save()
	ctx.translate(FLAG_CONTENT.x, FLAG_CONTENT.y)
	ctx.scale(FLAG_CONTENT.scale, FLAG_CONTENT.scale)
	drawContent()
	ctx.restore()
}

function drawPoint(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient,
		positive: boolean, drawContent: VoidFunction) {
	ctx.beginPath()
	ctx.arc(0, 0, POINT_RADIUS, 0, 2 * Math.PI)
	ctx.fillStyle = fill
	ctx.fill()
	ctx.strokeStyle = "white"
	ctx.lineWidth = 0.6
	ctx.stroke(path2D(BADGE_PATHS.pointArc))
	drawContent()
	ctx.translate(POINT_SIGN.x, POINT_SIGN.y)
	ctx.strokeStyle = positive ? "#00ff00" : "#ff0000"
	ctx.stroke(path2D(positive ? BADGE_PATHS.pointPlus : BADGE_PATHS.pointMinus))
	ctx.translate(-POINT_SIGN.x, -POINT_SIGN.y)
}

function drawBadge(ctx: CanvasRenderingContext2D, badge: BadgeLayout, style: StyleReader,
		font: string, details: number) {
	ctx.save()
	ctx.translate(badge.x, badge.y)
	switch (badge.type) {
		case 'regard': {
			const { char, value } = badge
			const r = POINT_RADIUS
			const n = Math.max(Math.abs(value), 1)
			for (let i = 0; i < n; i++) {
				drawPoint(ctx, fillStyle(ctx, char, style, [-r, -r, r, r]), value > 0,
					() => drawHead(ctx, headSrc(char), r, POINT_HEAD_CLIP, details))
				ctx.translate(-POINT_SPACING, 0)
			}
			break
		}
		case 'point': {
			const { id } = badge
			drawPoint(ctx, POINT_BACKGROUND, true, () => drawIcon(ctx, id))
			break
		}
		case 'flag': {
			const { flag } = badge
			drawFlag(ctx, style.color(FLAG_BACKGROUND), () => flag.length > 1
				? drawIcon(ctx, flag)
				: drawText(ctx, flag, 0, 1.6, font))
			break
		}
		case 'quiz': {
			const { n } = badge
			drawFlag(ctx, style.color(FLAG_BACKGROUND), () => {
				if (n > 0) {
					ctx.save()
					ctx.translate(QUIZ_ICON.x, 0)
					ctx.scale(QUIZ_ICON.scale, QUIZ_ICON.scale)
					drawIcon(ctx, 'quiz')
					ctx.restore()
					drawText(ctx, String(n), QUIZ_NUMBER_X, 1.6, font)
				} else {
					drawIcon(ctx, 'quiz')
				}
			})
			break
		}
		case 'select':
			const { n = -1 } = badge
			ctx.fillStyle = style.stroke(badge.link).color
			ctx.fill(path2D(BADGE_PATHS.select))
			drawText(ctx, (n >= 0 ? `${n+1}` : "?"), 0, 1.45, font,
				style.color("var(--badge-background)"))
			break
		case 'condition': {
			const c = COND_UNIT
			ctx.save()
			ctx.rotate(badge.angle * Math.PI / 180)
			drawShape(ctx, BADGE_PATHS.cond, fillStyle(ctx, badge.fill, style, [-c, -c, c, c * 1.5]))
			ctx.restore()
			const { icon } = badge
			if (badge.negative)
				drawStrike(ctx)
			if ('dots' in icon) {
				ctx.fillStyle = "white"
				ctx.beginPath()
				for (const x of [-DOTS_GAP, 0, DOTS_GAP]) {
					ctx.moveTo(x + DOTS_RADIUS, 0)
					ctx.arc(x, 0, DOTS_RADIUS, 0, 2 * Math.PI)
				}
				ctx.fill()
			} else if ('text' in icon) {
				drawText(ctx, icon.text, badge.iconX, badge.iconY, font, "white",
					badge.negative ? style.color(FLAG_BACKGROUND) : undefined)
			} else if ('icon' in icon) {
				drawIcon(ctx, icon.icon)
			} else {
				ctx.save()
				ctx.translate(0, COND_HEAD.y)
				drawHead(ctx, headSrc(icon.head), COND_HEAD.radius, COND_HEAD_CLIP, details)
				ctx.restore()
			}
			break
		}
	}
	ctx.restore()
	if (details > 0 && ((badge.type == 'regard' && !pointPersists(badge.char))
			|| (badge.type == 'flag' && !flagPersists(badge.flag))))
		drawHourglass(ctx, badge.x, badge.y, details)
}

function drawHourglass(ctx: CanvasRenderingContext2D, x: number, y: number, visibility: number) {
	ctx.save()
	ctx.globalAlpha *= visibility
	ctx.translate(x, y)
	ctx.scale(0.5 + 0.5 * visibility, 0.5 + 0.5 * visibility)
	ctx.beginPath()
	ctx.arc(HOURGLASS.x, HOURGLASS.y, HOURGLASS.radius, 0, 2 * Math.PI)
	ctx.fillStyle = HOURGLASS.background
	ctx.fill()
	ctx.strokeStyle = "white"
	ctx.lineWidth = 0.3
	ctx.stroke()
	ctx.fillStyle = HOURGLASS.sand
	ctx.fill(path2D(HOURGLASS.sandPath))
	ctx.strokeStyle = HOURGLASS.glass
	ctx.lineWidth = 0.2
	ctx.lineJoin = 'round'
	ctx.stroke(path2D(HOURGLASS.glassPath))
	ctx.lineWidth = 0.28
	ctx.stroke(path2D(HOURGLASS.frame))
	ctx.restore()
}

/** @param isLinkEnabled whether the links below `node` are drawn as enabled */
export function createBadgesDrawer(flowchart: GameFlowchart, nodes: FcNode[]): FcOverlayDrawer {

	const badges = nodes.flatMap(node => getBadgesLayout(node, flowchart))
	for (const badge of badges) {
		if (badge.type == 'regard')
			getHeadImage(headSrc(badge.char))
		else if (badge.type == 'condition' && 'head' in badge.icon)
			getHeadImage(headSrc(badge.icon.head))
	}
	return (ctx, view, style) => {
		const font = style.property('--ui-font') || 'sans-serif'
		const details = detailsVisibility(ctx)
		ctx.lineCap = 'round'
		ctx.textAlign = 'center'
		for (const badge of badges) {
			if (badge.x > view.left && badge.x < view.right
					&& badge.y > view.top && badge.y < view.bottom)
				drawBadge(ctx, badge, style, font, details)
		}
	}
}
