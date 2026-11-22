import { Fragment, memo } from "react"
import { noBb, textWithDashes } from "@tsukiweb/common/utils/Bbcode"
import { PageEntry } from "engine/history"
import { SceneName } from "app/utils/types"
import { SaveState } from "engine/savestates";
import { getSceneTitle } from "engine/utils";
import { useStrings } from "translation/lang";

type Props = {
	saveState: SaveState
}
const SaveSummary = ({saveState}: Props) => {
	useStrings()
	const lastPage = saveState.pages.at(-1)
	if (!lastPage) return null

	switch (lastPage.type ?? "text") {
		case "text":
			return textWithDashes(noBb(lastPage.text ?? "").trim())

		case "choice":
			const {choices} = lastPage as PageEntry<"choice">
			return choices.map(({index: i, str}) =>
				<Fragment key={i}>
					{i > 0 && <>/ </>}
					{textWithDashes(noBb(str))}
				</Fragment>
			)

		case "skip":
			const flags = saveState.scenes.at(-1)?.flags ?? []
			return noBb(getSceneTitle((lastPage as PageEntry<"skip">).label as SceneName) ?? "")
		
		default:
			throw Error(`unimplemented page type ${lastPage.type}`)
	}
}

export default memo(SaveSummary)