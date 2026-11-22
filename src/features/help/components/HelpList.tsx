import classNames from "classnames"
import { playScene } from "engine/savestates"
import { GraphicsGroup } from "@tsukiweb/common/graphics"
import { SceneName } from "app/utils/types";
import { settings, viewedScene } from "engine/settings";
import { SCENE_ATTRS } from "app/utils/constants";
import { KtFlagBadge } from "assets/icons/badges";
import { useStrings } from "translation/lang";
import { progresses } from "engine/progress";


type Help = {
	id: SceneName
	flag: string
	images: Record<string, string>
}

const helps: Help[] = [
	{
		id: "s524",
		flag: "4",
		images: { bg: "bg/bg_06a", r: "tachi/ark_t30" },
	},
	{
		id: "s525",
		flag: "5",
		images: { bg: "bg/bg_06a", r: "tachi/neko_t01a" },
	},
	{
		id: "s526",
		flag: "6",
		images: { bg: "bg/bg_06a" },
	},
	{
		id: "s527",
		flag: "finish",
		images: { bg: "bg/bg_06a", r: "tachi/ark_t31a" },
	},
	{
		id: "s547",
		flag: "",
		images: { bg: "bg/bg_06b" },
	},
]

export const getUnlockedHelps = ()=> settings.unlockEverything ? helps :
		helps.filter((_, i)=> (i == 0) ? progresses.list.length > 0 :
			SCENE_ATTRS["scene-points"].flags[helps[i-1].flag]?.some(lbl=>viewedScene(lbl))
		)

function play(id: SceneName) {
	playScene(id, {viewedOnly: false, extra: true})
}

const HelpList = () => {
	const strings = useStrings()

	return (
		<div className="help-list">
			{getUnlockedHelps().map(help => {
				const { id, flag, images } = help
				const seen = settings.unlockEverything || viewedScene(id)
				const title = flag
					? strings.extra["help-lesson"].replace('%0', `${helps.indexOf(help) + 1}`)
					: strings.extra["help-bonus"]
				return (
					<div
						key={id}
						className={classNames("help-card", {attention: !viewedScene(id)})}
						role="button"
						tabIndex={0}
						onClick={() => play(id)}
						onKeyDown={e => e.key === "Enter" && play(id)}
						nav-auto={1}
					>
						{seen ?
							<GraphicsGroup images={images} lazy />
						:
							<div className="help-placeholder" />
						}
						{flag && <KtFlagBadge flag={flag} className="badge help-flag" />}
						<div className="help-label">
							<span className="help-title">{title}</span>
						</div>
					</div>
				)
			})}
		</div>
	)
}

export default HelpList
