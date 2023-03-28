import {readFileSync, writeFileSync} from 'fs';
import {updateDefaultProps} from '../../codemods/update-default-props';
import {deserializeJSONWithDate} from '../../editor/components/RenderModal/SchemaEditor/date-serialization';
import type {ApiHandler} from '../api-types';
import {getProjectInfo} from '../project-info';
import type {UpdateDefaultPropsRequest} from '../render-queue/job';

export const updateDefaultPropsHandler: ApiHandler<
	UpdateDefaultPropsRequest,
	void
> = async ({input: {compositionId, defaultProps}, remotionRoot}) => {
	const projectInfo = await getProjectInfo(remotionRoot);
	// TODO: What happens if this error is thrown? Handle in frontend
	if (!projectInfo.videoFile) {
		throw new Error('Cannot find Roo.tsx file in project');
	}

	// TODO: Pass error to frontend
	const updated = await updateDefaultProps({
		compositionId,
		input: readFileSync(projectInfo.videoFile, 'utf-8'),
		newDefaultProps: deserializeJSONWithDate(defaultProps),
	});

	writeFileSync(projectInfo.videoFile, updated);
};
