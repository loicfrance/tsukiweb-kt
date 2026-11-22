import gameLogo from "@assets/images/game-logo.svg"
import '@features/title-menu/styles/title-menu.scss'
import * as m from "motion/react-m"
import { MdOutlineVolumeOff, MdOutlineVolumeUp } from 'react-icons/md'
import { useObserved } from '@tsukiweb/common/utils/Observer'
import { useLocation } from "wouter"
import { history } from 'engine/history'
import { TitleMenuButton } from '@tsukiweb/common/ui-core'
import { dialog } from '@tsukiweb/common/ui-core/components/ModalPrompt'
import classNames from "classnames"
import { audio } from "engine/audio"
import { useCallback, useEffect, useRef, useState } from "react"
import { continueGame, newGame, savesManager } from "engine/savestates";
import { importGameData, settings } from "engine/settings";
import AppInfo from "features/title-menu/components/AppInfo";
import TranslationSwitch from "features/title-menu/components/TranslationSwitch";
import { useStrings } from "translation/lang";
import { SCREEN } from "app/utils/display";
import { useExtraAttention, useScreenAutoNavigate } from "app/hooks";
import { FULLSAVE_EXT, SAVE_EXT, SCENE_ATTRS } from "app/utils/constants";
import { GameProgress } from "app/utils/types";
import ModalProgressSelection from "features/save/components/ProgressModal";
import { progresses } from "engine/progress";


const TitleMenuScreen = () => {
	useScreenAutoNavigate(SCREEN.TITLE)

	return (
		<m.div
			className="page" id="title-menu"
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}>
			<div className="logo">
				<m.img
					src={gameLogo} alt="Game's logo in Japanese, subtitled in English"
					draggable={false}
					className='game-logo'
					initial={{ opacity: 0, transform: "scale(0.8)" }}
					animate={{ opacity: 1, transform: "scale(1)" }}
					transition={{ duration: 0.8, ease: "easeOut" }} />
			</div>

			<TitleMenu />

			<TopActions />
		</m.div>
	)
}

export default TitleMenuScreen


const TitleMenu = () => {
	const strings = useStrings()
	const [, navigate] = useLocation()
	const canResume = useRef(savesManager.savesCount > 0 || history.pagesLength > 0)
	const [newGameSelectShow, setNewGameSelectShow] = useState<boolean>(false)
	const [progressToSave, setProgressToSave] = useState<GameProgress>()
	const extraAttention = useExtraAttention().any

	const openLoad = async () => {
		if (savesManager.savesCount === 0) {
			const confirmed = await dialog.confirm({
				text: <>{strings.saves.empty}<br />{strings.saves.import}</>,
				labelYes: strings.yes,
				labelNo: strings.no,
			})
			if (!confirmed || !await importGameData(`.${FULLSAVE_EXT},.${SAVE_EXT}`))
				return
		}
		navigate(SCREEN.LOAD)
	}
	useEffect(()=> {
		const script = history.script
		if (script?.canSaveProgress) {
			//TODO prompt to ask where to save progress
			const filter = (k:string)=>!(SCENE_ATTRS['scene-points'].reset.includes(k))
			const progress: GameProgress = {
				flags: Array.from(script.flags).filter(filter),
				points: Object.fromEntries(script.points.entries().filter(([k,v])=> filter(k))),
				pointScenes: script.pointScenes,
				lastSave: Date.now(),
				count: script.deathCount+1
			}
			setProgressToSave(progress)
		} else {
			setProgressToSave(undefined)
		}
	}, [history.script?.canSaveProgress])

	const progressSelectCallback = useCallback(async (p: GameProgress|undefined)=> {
		if (progressToSave) {
			if (!p) {
				const confirm = await dialog.confirm({
					text: <>
						{strings.saves['progress-discard']}
					</>,
					labelYes: strings.yes,
					labelNo: strings.no,
				})
				if (!confirm)
					return
			} else {
				progresses.replace(p, progressToSave)
			}
			history.script?.onProgressSaved()
			setProgressToSave(undefined)
		} else if (p)
			newGame(p)
		setNewGameSelectShow(false)
	}, [progressToSave])

	return (
		<nav className="menu">
			<div className='menu-buttons'>
				<TitleMenuButton audio={audio} onClick={()=> {
					if (progresses.list.length == 0)
						newGame(progresses.getEmpty())
					else
						setNewGameSelectShow(true)
				}} nav-auto={1}>
					{strings.title.start}
				</TitleMenuButton>
				<ModalProgressSelection
					show={newGameSelectShow || progressToSave != undefined}
					progress={progressToSave}
					onSelect={progressSelectCallback}/>

				{canResume.current &&
				<TitleMenuButton audio={audio} onClick={continueGame} nav-auto={1}>
					{strings.title.resume}
				</TitleMenuButton>
				}

				<TitleMenuButton audio={audio} onClick={openLoad} nav-auto={1}>
					{strings.title.load}
				</TitleMenuButton>

				<TitleMenuButton audio={audio} onClick={() => navigate(SCREEN.CONFIG)} nav-auto={1}>
					{strings.title.config}
				</TitleMenuButton>

				<TitleMenuButton audio={audio} onClick={() => navigate(SCREEN.GALLERY)} attention={extraAttention} nav-auto={1}>
					{strings.title.extra}
				</TitleMenuButton>
			</div>
		</nav>
	)
}

const TopActions = () => {
	const strings = useStrings()
	const [conf] = useObserved(settings.volume, 'master')

	return (
		<div className='top-actions'>
			<m.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 1, delay: 0.3 }}>
				<button
					nav-auto={1}
					className={classNames("action-icon", { inactive: conf < 0 })}
					aria-label={strings.config['volume-master']}
					onClick={()=> settings.volume.master = -settings.volume.master}
				>
					{conf < 0
						? <MdOutlineVolumeOff aria-label="mute" />
						: <MdOutlineVolumeUp aria-label="unmute" />
					}
				</button>
			</m.div>

			<m.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 1, delay: 0.15 }}>
				<TranslationSwitch className="action-icon" nav-auto={1}/>
			</m.div>

			<m.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 1 }}>
				<AppInfo className="action-icon" nav-auto={1}/>
			</m.div>
		</div>
	)
}