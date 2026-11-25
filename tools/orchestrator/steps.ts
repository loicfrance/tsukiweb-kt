import fs from 'fs/promises'
import path from 'path'

import { extractNsa } from '@tsukiweb/common/tools/extract-nsa/extractor.ts'
import { extractNscript } from '@tsukiweb/common/tools/extract-dat/extractor.ts'
import { processImages as applySpriteTransparency } from '@tsukiweb/common/tools/transform-sprites/processor.ts'
import { processImages as convertImages } from '@tsukiweb/common/tools/convert-images/processor.ts'
import { mergeVertical } from '@tsukiweb/common/tools/convert-images/editor.ts'
import { buildSpritesheets } from '@tsukiweb/common/tools/generate-thumbnails/processor.ts'
import { main as runLogicScripts } from '../helpers/convert-scripts/processing/logic.ts'
import { main as runSceneScripts } from '../helpers/convert-scripts/processing/scenes.ts'
import { main as runDailyMessages } from '../helpers/convert-scripts/processing/daily-messages.ts'
import type { Scene } from '@tsukiweb/common/tools/generate-thumbnails/processor.ts'
import { convertAudioTree } from '@tsukiweb/common/tools/convert-audio/converter.ts'
import { upscaleImages } from '@tsukiweb/common/tools/upscale-images/waifu2x.ts'
import {
  FFMPEG_AUDIO_ARGS,
  WAIFU2X_ARGS,
  BASE_LANG,
  imagePathsForLanguage,
  thumbConfig,
  x2Config,
  type CdPaths,
  type ImageConversionPaths,
  type Paths,
  type Tools,
} from './config.ts'

import {
  copyDirectory,
  directoryHasFiles,
  displayPath,
  ensureEmptyDirInside,
  listFilesRecursive,
  pathExists,
} from '@tsukiweb/common/tools/utils/fs-utils.ts'
import { withWorkingDirectory } from '@tsukiweb/common/tools/utils/process-utils.ts'
import { WORD_IMAGE_IDS } from '../../src/assets/game/word-images.ts'
import {
  check,
  combine,
  fileExistsCheck,
  listScriptLangs as listLangsIn,
  nonEmptyDirectoryCheck,
  type Check,
  type CheckDetail,
  type OrchestratorStep,
} from '@tsukiweb/common/tools/orchestrator/utils.ts'

interface StepContext {
  tools: Tools
  paths: Paths
}

const ARC_DIRS = [
  'wave',
  'image/bg',
  'image/event',
  'image/tachi',
]
const WORD_IMAGE_FILES = WORD_IMAGE_IDS.map(id => `image/word/${id}.jpg`)
const MSG_DIR = 'image/msg'
const MSG_SPRITE_REGEX = /^ran_t\d+\.jpe?g$/i

const listScriptLangs = (paths: Paths) => listLangsIn(path.dirname(paths.staticJp), BASE_LANG)
const arcDir = (paths: Paths) => path.join(paths.workspace, path.basename(paths.arcArchive))
const nonEmptyDirCheck = (directory: string) => nonEmptyDirectoryCheck(directory, displayPath(directory))
const fileCheck = (file: string) => fileExistsCheck(file, displayPath(file))

async function imageConversionPaths(paths: Paths): Promise<ImageConversionPaths[]> {
  const images: ImageConversionPaths[] = [paths]
  for (const lang of (await listScriptLangs(paths)).slice(1)) {
    const candidate = imagePathsForLanguage(paths, lang)
    if (await directoryHasFiles(candidate.img)) images.push(candidate)
  }
  return images
}

async function imgX2Checks(paths: Paths): Promise<CheckDetail[]> {
  return Promise.all(
    (await imageConversionPaths(paths)).map(images => nonEmptyDirCheck(images.imgX2))
  )
}

async function cdsWithInput(paths: Paths): Promise<CdPaths[]> {
  const cds = Object.values(paths.cds)
  const hasInput = await Promise.all(cds.map(dirs => directoryHasFiles(dirs.input)))
  return cds.filter((_, index) => hasInput[index])
}

async function arcDirsCheck(paths: Paths): Promise<Check> {
  return combine(await Promise.all(
    [
      ...ARC_DIRS.map(dir => nonEmptyDirCheck(path.join(arcDir(paths), dir))),
      ...WORD_IMAGE_FILES.map(file => fileCheck(path.join(arcDir(paths), file))),
    ]
  ))
}

async function imageDirChecks(paths: Paths): Promise<CheckDetail[]> {
  return Promise.all([
    ...['tachi', 'bg', 'event'].map(dir => nonEmptyDirCheck(path.join(paths.img, dir))),
    ...WORD_IMAGE_IDS.map(id => fileCheck(path.join(paths.img, 'word', `${id}.jpg`))),
  ])
}

async function convertedWordImageChecks(paths: Paths): Promise<CheckDetail[]> {
  return Promise.all([
    ...WORD_IMAGE_IDS.map(id => fileCheck(path.join(paths.images, 'word', `${id}.avif`))),
    ...WORD_IMAGE_IDS.map(id => fileCheck(path.join(paths.imagesThumb, 'word', `${id}.avif`))),
  ])
}

async function extractedAssetsAndImagesCheck(paths: Paths): Promise<Check> {
  const extractedAssets = await arcDirsCheck(paths)
  const images = await imageDirChecks(paths)
  return combine([
    ...extractedAssets.details,
    ...images,
  ])
}

async function scriptsOutputCheck(paths: Paths): Promise<Check> {
  const checks: CheckDetail[] = []

  for (const lang of await listScriptLangs(paths)) {
    const scenesDir = path.join(paths.staticJp, '..', lang, 'scenes')
    checks.push(await nonEmptyDirCheck(scenesDir))
  }

  return combine(checks)
}

async function prepareMsgImages(source: string, output: string, workspace: string): Promise<void> {
  if (!(await pathExists(source))) return

  const sprites = path.join(workspace, '_msg_sprites')
  await ensureEmptyDirInside(workspace, output)
  await ensureEmptyDirInside(workspace, sprites)
  for (const file of await fs.readdir(source)) {
    if (!file.startsWith('ran_')) continue
    const target = MSG_SPRITE_REGEX.test(file) ? sprites : output
    await fs.copyFile(path.join(source, file), path.join(target, file))
  }
  await applySpriteTransparency(sprites, output)
  await fs.rm(sprites, { recursive: true })
}

async function prepareImgFolder(paths: Paths): Promise<void> {
  const source = path.join(arcDir(paths), 'image', 'tachi')
  const tachiOutput = path.join(paths.img, 'tachi')

  if (path.resolve(source) === path.resolve(tachiOutput)) {
    throw new Error('Refusing to write transparent tachi over the archive source folder.')
  }

  const sourceFilesBefore = await listFilesRecursive(source)
  await ensureEmptyDirInside(paths.workspace, tachiOutput)
  await applySpriteTransparency(source, tachiOutput)

  const sourceFilesAfter = await listFilesRecursive(source)
  if (sourceFilesAfter.length !== sourceFilesBefore.length) {
    throw new Error('Archive tachi source changed while generating transparent sprites.')
  }

  await copyDirectory(path.join(arcDir(paths), 'image', 'bg'), path.join(paths.img, 'bg'), paths.workspace)
  await copyDirectory(path.join(arcDir(paths), 'image', 'event'), path.join(paths.img, 'event'), paths.workspace)
  await copyDirectory(path.join(arcDir(paths), 'image', 'word'), path.join(paths.img, 'word'), paths.workspace)
  await prepareMsgImages(path.join(arcDir(paths), 'image', 'msg'), path.join(paths.img, 'msg'), paths.workspace)
}

async function extractAssetsAndPrepareImages(paths: Paths): Promise<void> {
  await ensureEmptyDirInside(arcDir(paths), path.join(arcDir(paths), 'image', 'word'))
  await extractNsa(paths.arcArchive, arcDir(paths), [...ARC_DIRS, MSG_DIR, ...WORD_IMAGE_FILES])
  if (await pathExists(paths.nscript)) {
    await extractNscript(paths.nscript, path.join(paths.staticJp, 'sources', 'fullscript-kt_jp.txt'))
  }
  await prepareImgFolder(paths)
  for (const lang of (await listScriptLangs(paths)).slice(1)) {
    const source = path.join(paths.staticJp, '..', lang, 'sources')
    const { img } = imagePathsForLanguage(paths, lang)
    await ensureEmptyDirInside(paths.workspace, img)
    if (!(await pathExists(source))) continue
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'tachi') {
          await applySpriteTransparency(path.join(source, entry.name), path.join(img, entry.name))
        } else {
          await copyDirectory(path.join(source, entry.name), path.join(img, entry.name), paths.workspace)
        }
      }
    }
  }
}

async function runScripts(paths: Paths): Promise<void> {
  await withWorkingDirectory(path.join(paths.tools, 'helpers', 'convert-scripts'), async () => {
    runLogicScripts()
    runSceneScripts()
    runDailyMessages()
  })
}

async function runWaifu2x(context: StepContext): Promise<void> {
  const waifu2x = await context.tools.waifu2x.executable()
  for (const conversion of await imageConversionPaths(context.paths)) {
    await upscaleImages(waifu2x, WAIFU2X_ARGS, conversion.img, conversion.imgX2)
  }
}

async function runImageConversion(paths: Paths): Promise<void> {
  for (const conversion of await imageConversionPaths(paths)) {
    const thumb = thumbConfig(conversion)
    const x2 = x2Config(conversion)

    await convertImages(thumb.inputDir, thumb.outputDir, thumb.options)
    await convertImages(x2.inputDir, x2.outputDir, x2.options)
  }
}

async function runSpritesheets(paths: Paths): Promise<void> {
  const sceneAttrs = JSON.parse(await fs.readFile(paths.sceneAttrs, 'utf8'))
  const flowchart = JSON.parse(await fs.readFile(path.join(paths.sceneAssets, 'flowchart.json'), 'utf8'))
  const scenes = Object.keys(flowchart.scenes ?? {})
    .filter(name => sceneAttrs['scene-graphs']?.[name])
    .map(name => [name, { graph: sceneAttrs['scene-graphs'][name] }] as [string, Scene])

  if (!scenes.length) {
    throw new Error('No flowchart scenes with graphics found; spritesheet metadata was not changed.')
  }

  await buildSpritesheets(scenes, paths.img, paths.flowchartSpritesheets, paths.sceneAssets)
}

function cdTrackOutputName(relativePath: string): string {
  const filename = path.parse(relativePath).name
  const track = filename.match(/\d+/)?.[0]
  if (!track) {
    throw new Error(`Cannot find track number in "${relativePath}".`)
  }

  return `track${track.padStart(2, '0')}.webm`
}

async function runCdConversion(context: StepContext): Promise<void> {
  const ffmpeg = await context.tools.ffmpeg.executable()
  for (const dirs of await cdsWithInput(context.paths)) {
    await convertAudioTree(ffmpeg, FFMPEG_AUDIO_ARGS, dirs.input, dirs.output, cdTrackOutputName)
  }
}

export function createSteps(context: StepContext): OrchestratorStep[] {
  const { tools, paths } = context

  return [
    {
      id: 1,
      title: 'Extract arc.nsa/nscript.dat and prepare images',
      canRun: async () => combine([
        await fileCheck(paths.arcArchive),
      ]),
      isDone: async () => extractedAssetsAndImagesCheck(paths),
      run: async () => extractAssetsAndPrepareImages(paths),
    },
    {
      id: 2,
      title: 'Process fullscripts',
      dependsOn: [1],
      canRun: async () => combine([]),
      isDone: async () => scriptsOutputCheck(paths),
      run: async () => runScripts(paths),
    },
    {
      id: 3,
      title: 'Upscale images with waifu2x',
      dependsOn: [1],
      canRun: async () => combine([
        await tools.waifu2x.check(),
        ...(await imageDirChecks(paths)),
      ]),
      isDone: async () => combine([
        ...(await imgX2Checks(paths)),
        ...await Promise.all(
          WORD_IMAGE_IDS.map(id => fileCheck(path.join(paths.imgX2, 'word', `${id}.png`)))
        ),
      ]),
      run: async () => runWaifu2x(context),
    },
    {
      id: 4,
      title: 'Convert images',
      dependsOn: [3],
      canRun: async () => combine([
        await nonEmptyDirCheck(paths.img),
        ...(await imgX2Checks(paths)),
      ]),
      isDone: async () => combine([
        ...await Promise.all(
          (await imageConversionPaths(paths)).flatMap(images => [
            nonEmptyDirCheck(images.images),
            nonEmptyDirCheck(images.imagesThumb),
          ])
        ),
        ...await convertedWordImageChecks(paths),
      ]),
      run: async () => runImageConversion(paths),
    },
    {
      id: 5,
      title: 'Create spritesheets',
      dependsOn: [1, 2],
      canRun: async () => combine([
        await nonEmptyDirCheck(paths.img),
      ]),
      isDone: async () => combine([
        await nonEmptyDirCheck(paths.flowchartSpritesheets),
      ]),
      run: async () => runSpritesheets(paths),
    },
    {
      id: 6,
      title: 'Convert wave files',
      dependsOn: [1],
      canRun: async () => combine([
        await tools.ffmpeg.check(),
        await nonEmptyDirCheck(path.join(arcDir(paths), 'wave')),
      ]),
      isDone: async () => combine([
        await nonEmptyDirCheck(paths.wave),
      ]),
      run: async () => convertAudioTree(
        await tools.ffmpeg.executable(),
        FFMPEG_AUDIO_ARGS,
        path.join(arcDir(paths), 'wave'),
        paths.wave,
      ),
    },
    {
      id: 7,
      title: 'Convert audio CDs',
      canRun: async () => combine([
        await tools.ffmpeg.check(),
        check(
          (await cdsWithInput(paths)).length > 0,
          `${Object.values(paths.cds).map(dirs => displayPath(dirs.input)).join(', ')} are all empty`,
        ),
      ]),
      isDone: async () => {
        const cds = await cdsWithInput(paths)
        return combine(cds.length
          ? await Promise.all(cds.map(dirs => nonEmptyDirCheck(dirs.output)))
          : [check(false, 'no CD files')])
      },
      run: async () => runCdConversion(context),
    },
  ]
}
