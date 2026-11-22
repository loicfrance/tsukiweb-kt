import classNames from "classnames"
import { GraphicsGroup } from "@tsukiweb/common/graphics"
import SaveSummary from "./SaveSummary"
import { jsonMerge } from "@tsukiweb/common/utils/utils"
import { ComponentProps } from "react"
import { ChoicesPreview } from "@tsukiweb/common/choices"
import { QUICK_SAVE_ID, SaveState } from "engine/savestates";
import { getLocale, useStrings } from "translation/lang";
import { getSceneTitle, isScene } from "engine/utils";
import { SceneName } from "app/utils/types";

type SaveListItemProps = ComponentProps<"button"> & {
	saveId: number
	saveState: SaveState
	isFocused?: boolean
}
const SaveListItem = ({saveId, saveState, isFocused, ...props}: SaveListItemProps)=> {
	const strings = useStrings()
	const date = new Date(saveState.date as number)
	const isQuickSave = saveId === QUICK_SAVE_ID
	const lastPage = saveState.pages.at(-1)!
	const graphics = jsonMerge(saveState.graphics ?? {},
			lastPage.graphics ?? {bg: "#000"})
	const isExtra = saveState.scenes.some(s => s.extra)
	const lastScene = saveState.pages.findLast(p=>p.label && isScene(p.label))?.label as SceneName|undefined

	return (
		<button
			className={classNames("save-container", {active: isFocused})}
			{...props}
		>
			<div className="graphics-area">
				<GraphicsGroup
					images={graphics}
					resolution="thumb"
					lazy={true}
				/>
				{lastPage?.type === "choice" &&
					<ChoicesPreview choices={(lastPage as any).choices} />
				}
				{isExtra &&
					<span className="extra-mark">{strings.title.extra}</span>
				}
			</div>
			<div className="details">
				<div className="context">
					<span className="scene">{lastScene && getSceneTitle(lastScene)}</span>
				</div>
				<div className="line">
					<SaveSummary saveState={saveState}/>
				</div>
				<time dateTime={date.toISOString()} className="date">
					{isQuickSave && <>{date.toLocaleDateString(getLocale())} </>}
					{date.toLocaleTimeString(getLocale(), {hour: 'numeric', minute: '2-digit'})}
				</time>
			</div>
			{isQuickSave &&
				<span className="quick-save">{strings.saves["quick-save"]}</span>
			}
		</button>
	)
}

export default SaveListItem
