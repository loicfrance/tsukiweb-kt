import * as m from "motion/react-m"
import { AnimatePresence } from "motion/react"
import { PropsWithChildren, useEffect, useRef } from "react"
import "../../features/title-menu/styles/extra.scss"
import { useStrings } from "translation/lang"
import { useLocation } from "wouter"
import { BackButton, HintsBar, PageHeader, PageSwitcher, PageTitle, TitleMenuButton } from "@tsukiweb/common/ui-core"
import { audio } from "engine/audio"
import { SCREEN, displayMode } from "app/utils/display";
import { useDefaultNavBack, useNavBackRef } from "@tsukiweb/common/hooks"
import Ornament from "@assets/images/ornament.webp"
import { settings } from "engine/settings";
import { useExtraAttention } from "app/hooks";


type ExtraPage = {
	screen: SCREEN
	id: string
	label: string
	attention?: boolean
	locked?: boolean
}

function back() {
	displayMode.screen = SCREEN.TITLE
}

function useExtraPages(): ExtraPage[] {
	const strings = useStrings()
	const extra = useExtraAttention()
	return [
		{ screen: SCREEN.GALLERY, id: "extra-gallery", label: strings.extra.gallery },
		{ screen: SCREEN.SCENES, id: "extra-scenes", label: strings.extra.scenes },
		{ screen: SCREEN.DREAMS, id: "extra-dreams", label: strings.extra.dreams, attention: extra.dreams.attention, locked: extra.dreams.locked },
		{ screen: SCREEN.SUMMER_FES, id: "extra-summer-fes", label: strings.extra["summer-fes"], attention: extra.summerFes.attention, locked: extra.summerFes.locked },
		{ screen: SCREEN.HELP, id: "extra-help", label: strings.extra.help, attention: extra.help.attention, locked: extra.help.locked },
		(settings.unlockEverything || settings.readDailyMessages.length > 0) &&
			{ screen: SCREEN.DAILY_MESSAGES, id: "extra-daily-messages", label: strings.extra["daily-messages"] },
	].filter(page => !!page)
}

const ExtraShell = ({ children }: PropsWithChildren) => {
	const [location, navigate] = useLocation()
	const strings = useStrings()
	const pages = useExtraPages()
	const extraLocation = useRef(location)
	if (pages.some(({ screen }) => location.startsWith(screen)))
		extraLocation.current = location
	const currentPage = "/" + extraLocation.current.split("/")[1]

	const contentBack = () => {
		if (!document.body.classList.contains("keyboard-navigating"))
			return back()
		const currentPage = "/" + window.location.pathname.split("/")[1]
		document.querySelector<HTMLElement>(`#extra-${currentPage.slice(1)}`)?.focus()
	}

	const navBackRef = useNavBackRef(contentBack)

	useDefaultNavBack(back)

	useEffect(()=> {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				back()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [])

	return (
		<m.div
			id="extra"
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}>
			<img src={Ornament} alt="" className="leftOrnament" />
			<img src={Ornament} alt="" className="rightOrnament" />

			<PageHeader className="extra-header"
				title={pages.find(({ screen }) => screen === currentPage)?.label ?? strings.title.extra} />

			<AnimatePresence mode="wait" initial={false}>
				<m.main
					className="extra-content"
					ref={navBackRef}
					initial={{opacity: 0}}
					animate={{opacity: 1, transition: {duration: 0.22, ease: "easeOut"}}}
					exit={{opacity: 0, transition: {duration: 0.12, ease: "easeIn"}}}
					key={extraLocation.current}
				>
					{children}
				</m.main>
			</AnimatePresence>

			<ExtraMenu pages={pages} currentPage={currentPage} navigate={navigate} />

			<HintsBar className="extra-footer" audio={audio} onBack={()=>navigate(SCREEN.TITLE)}>
				<PageSwitcher className="extra-switcher" audio={audio}
					pages={pages.map(({ screen, label, attention, locked }) => ({ value: screen, label, attention, locked }))}
					selected={currentPage}
					onSelect={navigate} />
			</HintsBar>
		</m.div>
	)
}

export default ExtraShell

type MenuProps = {
	pages: ExtraPage[]
	currentPage: string
	navigate: (screen: string) => void
}

const ExtraMenu = ({ pages, currentPage, navigate }: MenuProps) => {
	const strings = useStrings()

	return (
		<div className="extra-menu">
			<PageTitle>
				{strings.title.extra}
			</PageTitle>
			<div className="menus" role="tablist">
				{pages.map(({ screen, id, label, attention, locked=false }) =>
					<TitleMenuButton key={id} id={id}
						audio={audio}
						onClick={()=>navigate(screen)}
						active={currentPage === screen}
						aria-selected={currentPage === screen}
						attention={attention}
						disabled={locked}
						role="tab"
						nav-auto={1}>
						{label}
					</TitleMenuButton>
				)}
			</div>
			<div className="back-action">
				<BackButton compact audio={audio} onClick={()=>navigate(SCREEN.TITLE)} nav-auto={1} />
			</div>
		</div>
	)
}
