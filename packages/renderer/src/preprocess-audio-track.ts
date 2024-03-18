import type {DownloadMap} from './assets/download-map';
import {getAudioChannelsAndDuration} from './assets/get-audio-channels';
import type {MediaAsset} from './assets/types';
import {calculateFfmpegFilter} from './calculate-ffmpeg-filters';
import {callFf} from './call-ffmpeg';
import {makeFfmpegFilterFile} from './ffmpeg-filter-file';
import type {LogLevel} from './log-level';
import {Log} from './logger';
import type {CancelSignal} from './make-cancel-signal';
import {pLimit} from './p-limit';
import {parseFfmpegProgress} from './parse-ffmpeg-progress';
import {resolveAssetSrc} from './resolve-asset-src';
import {DEFAULT_SAMPLE_RATE} from './sample-rate';
import type {ProcessedTrack} from './stringify-ffmpeg-filter';

type Options = {
	outName: string;
	asset: MediaAsset;
	fps: number;
	downloadMap: DownloadMap;
	indent: boolean;
	logLevel: LogLevel;
	binariesDirectory: string | null;
	cancelSignal: CancelSignal | undefined;
	chunkLengthInSeconds: number;
	trimLeftOffset: number;
	trimRightOffset: number;
	forSeamlessAacConcatenation: boolean;
	onProgress: (progress: number) => void;
};

export type PreprocessedAudioTrack = {
	outName: string;
	filter: ProcessedTrack;
};

const preprocessAudioTrackUnlimited = async ({
	outName,
	asset,
	fps,
	downloadMap,
	indent,
	logLevel,
	binariesDirectory,
	cancelSignal,
	onProgress,
	chunkLengthInSeconds,
	trimLeftOffset,
	trimRightOffset,
	forSeamlessAacConcatenation,
}: Options): Promise<PreprocessedAudioTrack | null> => {
	const {channels, duration} = await getAudioChannelsAndDuration({
		downloadMap,
		src: resolveAssetSrc(asset.src),
		indent,
		logLevel,
		binariesDirectory,
		cancelSignal,
	});

	const filter = calculateFfmpegFilter({
		asset,
		fps,
		channels,
		assetDuration: duration,
		chunkLengthInSeconds,
		trimLeftOffset,
		trimRightOffset,
		forSeamlessAacConcatenation,
	});

	if (filter === null) {
		return null;
	}

	const {cleanup, file} = await makeFfmpegFilterFile(filter, downloadMap);

	const args = [
		['-hide_banner'],
		['-i', resolveAssetSrc(asset.src)],
		['-ac', '2'],
		['-filter_script:a', file],
		['-c:a', 'pcm_s16le'],
		['-ar', String(DEFAULT_SAMPLE_RATE)],
		['-y', outName],
	].flat(2);

	Log.verbose(
		{indent, logLevel},
		'Preprocessing audio track',
		args,
		'Filter:',
		filter.filter,
	);
	const startTime = Date.now();

	const task = callFf({
		bin: 'ffmpeg',
		args,
		indent,
		logLevel,
		binariesDirectory,
		cancelSignal,
	});

	task.stderr?.on('data', (data: Buffer) => {
		const utf8 = data.toString('utf8');
		const parsed = parseFfmpegProgress(utf8, fps);
		if (parsed !== undefined) {
			onProgress(parsed / (chunkLengthInSeconds * fps));
		}
	});

	await task;

	Log.verbose(
		{indent, logLevel},
		'Preprocessed audio track',
		`${Date.now() - startTime}ms`,
	);

	cleanup();
	return {outName, filter};
};

const limit = pLimit(2);

export const preprocessAudioTrack = (options: Options) => {
	return limit(preprocessAudioTrackUnlimited, options);
};
