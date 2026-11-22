import { ReactNode } from "react"
import classNames from "classnames"
import { playScene } from "engine/savestates"
import { useStrings } from "translation/lang"
import { GraphicsGroup } from "@tsukiweb/common/graphics"
import { SceneName } from "app/utils/types";
import { useFestivalsAccess } from "../hooks/useFestivalsAccess";
import { viewedScene } from "engine/settings";
import { festivalFinale, festivals } from "../utils/summer-fes";

function play(id: SceneName) {
	playScene(id, {viewedOnly: false, extra: true})
}

type FesShortcutProps = {
	id: SceneName
	images: Record<string, string>
	title: ReactNode
	className: string
}
const FesShortcut = ({ id, images, title, className }: FesShortcutProps) => (
	<div
		className={classNames(className, {attention: !viewedScene(id)})}
		role="button"
		tabIndex={0}
		onClick={() => play(id)}
		onKeyDown={e => e.key === "Enter" && play(id)}
		nav-auto={1}
	>
		<GraphicsGroup images={images} lazy />
		<div className="fes-label">
			<span className="fes-name">{title}</span>
		</div>
	</div>
)

const SummerFesList = () => {
	const strings = useStrings()
	const { dreamingUnlocked } = useFestivalsAccess()

	return (
		<>
			<div className="fes-cards">
				{festivals.map(({ id, character, images }) =>
					<FesShortcut
						key={id}
						id={id}
						images={images}
						title={strings.characters[character]}
						className="fes-card"
					/>
				)}
			</div>

			{dreamingUnlocked ?
				<FesShortcut
					id={festivalFinale.id}
					images={festivalFinale.images}
					title={strings.scenario.scenes[festivalFinale.id]}
					className="fes-finale"
				/>
			:
				<div className="fes-finale locked" aria-disabled="true">
					<div className="fes-label">
						<span className="fes-name">???</span>
					</div>
				</div>
			}
		</>
	)
}

export default SummerFesList
