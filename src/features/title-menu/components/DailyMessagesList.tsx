import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence } from "motion/react"
import * as m from "motion/react-m"
import classNames from "classnames"
import { Button } from "@tsukiweb/common/ui-core"
import { audio } from "engine/audio"
import { getLocale, useStrings } from "translation/lang"
import { imageSrc } from "translation/assets"
import DailyMessageScreen from "app/screens/DailyMessageScreen"
import DailyMessageStage from "@features/title-menu/components/DailyMessageStage"
import { DailyMessage, DailyMessageId, getDailyMessage, listDailyMessages } from "@features/title-menu/utils/daily-message"

const LEADER_REGEX = /…{4,}/g
const FADE_DURATION = 0.2
const SWITCH_DURATION = 0.25

function preload(image: string) {
	return new Promise(resolve => {
		const img = new Image()
		img.onload = img.onerror = resolve
		img.src = imageSrc(image)
	})
}

type Row = {
	id: DailyMessageId
	label: string
	preview?: string
}

function messageLabel(id: DailyMessageId) {
	if (typeof id == "number")
		return String(id + 1).padStart(3, '0')
	const [month, day] = id.split('-').map(Number)
	return new Date(2000, month - 1, day)
		.toLocaleDateString(getLocale(), { month: 'long', day: 'numeric' })
}

type RowProps = Row & {
	active: boolean
	select: (id: DailyMessageId) => void
}

const MessageRow = memo(({ id, label, preview, active, select }: RowProps) =>
	<Button
		variant={null}
		className={classNames("daily-row", { active })}
		disabled={!preview}
		audio={audio}
		clickSound="tick"
		onClick={() => select(id)}
		nav-auto={preview ? 1 : undefined}
	>
		<span className="daily-label">{label}</span>
		<span className="daily-line">{preview}</span>
	</Button>
)

type Section = {
	id: "dates" | "random"
	title: string
	rows: Row[]
}

const DailyMessagesList = () => {
	const strings = useStrings()
	const [selectedId, setSelectedId] = useState<DailyMessageId | null>(null)
	const [opened, setOpened] = useState<DailyMessage | null>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const close = useCallback(() => setOpened(null), [])

	const sections: Section[] = useMemo(() => {
		const rows = listDailyMessages().map(({ id, entry, read }) => ({
			id,
			label: messageLabel(id),
			preview: read
				? entry.text.filter(line => line).join(' ').replaceAll(LEADER_REGEX, '…')
				: undefined,
		}))
		return [
			{ id: "random", title: strings.extra["daily-messages-random"], rows: rows.filter(({ id }) => typeof id == "number") },
			{ id: "dates", title: strings.extra["daily-messages-dates"], rows: rows.filter(({ id }) => typeof id == "string") },
		]
	}, [strings])
	const readRows = sections.flatMap(({ rows }) => rows.filter(({ preview }) => preview))

	const current = readRows.find(({ id }) => id === selectedId)?.id ?? readRows[0]?.id
	const message = useMemo(() => current != null ? getDailyMessage(current) : null, [current, strings])

	const [shown, setShown] = useState<{ message: DailyMessage, key: number } | null>(null)
	useEffect(() => {
		if (!message) {
			setShown(null)
			return
		}
		let cancelled = false
		Promise.all([message.bg, message.fg].map(preload)).then(() => {
			if (!cancelled)
				setShown(previous => ({ message, key: (previous?.key ?? 0) + 1 }))
		})
		return () => { cancelled = true }
	}, [message])

	const shownRef = useRef(shown?.message)
	shownRef.current = shown?.message

	const select = useCallback((id: DailyMessageId) => {
		if (shownRef.current?.id === id)
			setOpened(shownRef.current)
		else
			setSelectedId(id)
	}, [])

	useEffect(() => {
		const list = listRef.current
		const active = list?.querySelector<HTMLElement>(".daily-row.active")
		if (list && active)
			list.scrollTop = active.offsetTop - (list.clientHeight - active.offsetHeight) / 2
	}, [])

	return (
		<>
			<div className="daily-viewer">
				<button type="button" className="daily-viewer-stage"
					disabled={!shown}
					onClick={() => shown && setOpened(shown.message)}>
					<AnimatePresence initial={false}>
						{shown &&
							<m.div key={shown.key} className="daily-viewer-slide"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 1 }}
								transition={{ duration: SWITCH_DURATION }}>
								<DailyMessageStage message={shown.message} />
							</m.div>
						}
					</AnimatePresence>
				</button>
			</div>
			<div className="daily-list" ref={listRef}>
				{sections.map(({ id, title, rows }) =>
					<section key={id} className={`daily-section ${id}`}>
						<h3 className="daily-section-title">
							{title}
							<span className="daily-count">
								{rows.filter(({ preview }) => preview).length} / {rows.length}
							</span>
						</h3>
						{rows.map(row =>
							<MessageRow key={row.id} {...row} active={row.id === current} select={select} />
						)}
					</section>
				)}
			</div>
			{createPortal(
				<AnimatePresence>
					{opened &&
						<DailyMessageScreen key={opened.id} message={opened}
							onClose={close} fadeDuration={FADE_DURATION} />
					}
				</AnimatePresence>,
				document.body
			)}
		</>
	)
}

export default DailyMessagesList
