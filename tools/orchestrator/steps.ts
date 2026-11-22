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
import {
  FFMPEG_AUDIO_ARGS,
  WAIFU2X_ARGS,
  BASE_LANG,
  imagePathsForLanguage,
  thumbConfig,
  x2Config,
  type ImageConversionPaths,
  type Paths,
  type ToolConfig,
} from './config.ts'

import {
  copyDirectory,
  directoryHasFiles,
  displayPath,
  ensureEmptyDirInside,
  isMediaFile,
  listFilesRecursive,
  pathExists,
} from '@tsukiweb/common/tools/utils/fs-utils.ts'
import { resolveExecutable, runCommand, withWorkingDirectory } from '@tsukiweb/common/tools/utils/process-utils.ts'
import { logger } from '@tsukiweb/common/tools/utils/logger.ts'
import { WORD_IMAGE_IDS } from '../../src/assets/game/word-images.ts'
import {
  check,
  combine,
  fileExistsCheck,
  listScriptLangs as listLangsIn,
  nonEmptyDirectoryCheck,
  stateFailure,
  type Check,
  type CheckDetail,
  type OrchestratorStep,
} from '@tsukiweb/common/tools/orchestrator/utils.ts'

interface StepContext {
  config: ToolConfig
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
  const nscript = path.join(paths.tools, 'nscript.dat')
  if (await pathExists(nscript)) {
    await extractNscript(nscript, path.join(paths.staticJp, 'sources', 'fullscript-kt_jp.txt'))
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
  const executable = await resolveExecutable(context.config.WAIFU2X_CAFFE, context.paths.tools)
  for (const conversion of await imageConversionPaths(context.paths)) {
    const total = (await listFilesRecursive(conversion.img)).length
    const updateProgress = async () => {
      const processed = (await listFilesRecursive(conversion.imgX2)).length
      logger.progress(`Upscaling images: ${Math.min(processed, total)}/${total}`)
    }
    const args = [
      '-i', conversion.img,
      '-o', conversion.imgX2,
      ...WAIFU2X_ARGS,
    ]

    await updateProgress()
    const timer = setInterval(() => void updateProgress(), 1000)
    try {
      await runCommand(executable.command, args, { cwd: executable.cwd, stdout: 'ignore' })
    } finally {
      clearInterval(timer)
    }
    await updateProgress()
  }
  logger.done()
}

async function runImageConversion(paths: Paths): Promise<void> {
  for (const conversion of await imageConversionPaths(paths)) {
    const thumb = thumbConfig(conversion)
    const x2 = x2Config(conversion)

    await convertImages(thumb.inputDir, thumb.outputDir, thumb.options)
    await convertImages(x2.inputDir, x2.outputDir, x2.options)
  }
  logger.done()
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

async function convertAudioTree(
  ffmpeg: Awaited<ReturnType<typeof resolveExecutable>>,
  inputDir: string,
  outputDir: string,
  outputName: (relativePath: string) => string = relativePath => `${path.parse(relativePath).name}.webm`,
): Promise<void> {
  const files = (await listFilesRecursive(inputDir)).filter(isMediaFile)
  const outputPaths = new Set<string>()

  for (let i = 0; i < files.length; i++) {
    const relativePath = files[i]
    const inputPath = path.join(inputDir, relativePath)
    const outputPath = path.join(outputDir, path.dirname(relativePath), outputName(relativePath))

    if (outputPaths.has(outputPath)) {
      throw new Error(`Duplicate output audio file "${displayPath(outputPath)}".`)
    }
    outputPaths.add(outputPath)

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    console.log(`Converting audio: ${i + 1}/${files.length} ${relativePath}`)
    await runCommand(ffmpeg.command, [
      '-y',
      '-i', inputPath,
      ...FFMPEG_AUDIO_ARGS,
      outputPath,
    ], { cwd: ffmpeg.cwd })
  }
}

function cdTrackOutputName(relativePath: string): string {
  const filename = path.parse(relativePath).name
  const track = filename.match(/\d+/)?.[0]
  if (!track) {
    throw new Error(`Cannot find track number in "${relativePath}".`)
  }

  return `track${track.padStart(2, '0')}.webm`
}

async function runWaveConversion(context: StepContext): Promise<void> {
  const ffmpeg = await resolveExecutable(context.config.FFMPEG, context.paths.tools)
  await convertAudioTree(ffmpeg, path.join(arcDir(context.paths), 'wave'), context.paths.wave)
}

async function runCdConversion(context: StepContext): Promise<void> {
  const ffmpeg = await resolveExecutable(context.config.FFMPEG, context.paths.tools)

  for (const [name, dirs] of Object.entries(context.paths.cds)) {
    if (!(await directoryHasFiles(dirs.input))) continue
    console.log(`\n${name}`)
    await convertAudioTree(ffmpeg, dirs.input, dirs.output, cdTrackOutputName)
  }
}

async function executableCheck(configValue: string, baseDir: string): Promise<CheckDetail> {
  const executable = await resolveExecutable(configValue, baseDir)
  const displayName = path.isAbsolute(executable.command)
    ? displayPath(executable.command)
    : executable.command
  return check(executable.found, `${displayName} is unavailable`)
}

export function createSteps(context: StepContext): OrchestratorStep[] {
  const { config, paths } = context

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
      canRun: async () => combine([]),
      isDone: async () => scriptsOutputCheck(paths),
      run: async () => runScripts(paths),
    },
    {
      id: 3,
      title: 'Upscale images with waifu2x',
      canRun: async () => combine([
        await executableCheck(config.WAIFU2X_CAFFE, paths.tools),
        ...(await imageDirChecks(paths)),
      ]),
      isDone: async () => combine([
        ...await Promise.all(
          (await imageConversionPaths(paths)).map(images => nonEmptyDirCheck(images.imgX2))
        ),
        ...await Promise.all(
          WORD_IMAGE_IDS.map(id => fileCheck(path.join(paths.imgX2, 'word', `${id}.png`)))
        ),
      ]),
      run: async () => runWaifu2x(context),
    },
    {
      id: 4,
      title: 'Convert images',
      canRun: async () => combine([
        await nonEmptyDirCheck(paths.img),
        ...await Promise.all(
          (await imageConversionPaths(paths)).map(images => nonEmptyDirCheck(images.imgX2))
        ),
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
      canRun: async () => combine([
        await executableCheck(config.FFMPEG, paths.tools),
        await nonEmptyDirCheck(path.join(arcDir(paths), 'wave')),
      ]),
      isDone: async () => combine([
        await nonEmptyDirCheck(paths.wave),
      ]),
      run: async () => runWaveConversion(context),
    },
    {
      id: 7,
      title: 'Convert audio CDs',
      canRun: async () => {
        const executable = await executableCheck(config.FFMPEG, paths.tools)
        const cdChecks = await Promise.all(
          Object.values(paths.cds).map(async dirs =>
            nonEmptyDirCheck(dirs.input)
          )
        )

        return combine([
          executable,
          check(
            cdChecks.some(item => item.ok),
            `${cdChecks.map(item => {
              if (typeof item.failure === 'object') return item.failure.target
              return item.failure
            }).join(', ')} are all empty`,
          ),
        ])
      },
      isDone: async () => combine(await Promise.all(
        Object.values(paths.cds).map(async dirs =>
          check(
            await directoryHasFiles(dirs.output),
            stateFailure(displayPath(dirs.output), 'empty'),
          )
        )
      )),
      run: async () => runCdConversion(context),
    },
  ]
}
