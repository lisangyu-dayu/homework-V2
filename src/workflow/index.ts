// 作业批改主工作流（M4/M5 完成实现）
import { Dag, type DagContext } from './dag';
import * as preprocess from './nodes/preprocess';
import * as layoutSplit from './nodes/layoutSplit';
import * as parseQuestion from './nodes/parseQuestion';
import * as selfSolve from './nodes/selfSolve';
import * as verify from './nodes/verify';
import * as extractStudentAnswer from './nodes/extractStudentAnswer';
import * as grade from './nodes/grade';
import * as generateExplanation from './nodes/generateExplanation';
import * as kpTagging from './nodes/kpTagging';
import * as persist from './nodes/persist';
import * as render from './nodes/render';

export interface AssignmentCtx extends DagContext {
  originalImagePath: string;
  childId: string;
  subject: string;
}

export async function runAssignment(ctx: AssignmentCtx): Promise<{ shortId: string }> {
  const dag = new Dag<AssignmentCtx>();
  dag
    .register({ name: 'preprocess',           handler: preprocess.run })
    .register({ name: 'layoutSplit',          deps: ['preprocess'],           handler: layoutSplit.run })
    .register({ name: 'parseQuestion',        deps: ['layoutSplit'],          handler: parseQuestion.run })
    .register({ name: 'selfSolve',            deps: ['parseQuestion'],        handler: selfSolve.run })
    .register({ name: 'verify',               deps: ['selfSolve'],            handler: verify.run })
    .register({ name: 'extractStudentAnswer', deps: ['parseQuestion'],        handler: extractStudentAnswer.run })
    .register({ name: 'grade',                deps: ['verify', 'extractStudentAnswer'], handler: grade.run })
    .register({ name: 'generateExplanation',  deps: ['grade'],                handler: generateExplanation.run })
    .register({ name: 'kpTagging',            deps: ['parseQuestion'],        handler: kpTagging.run })
    .register({ name: 'persist',              deps: ['generateExplanation', 'kpTagging'], handler: persist.run })
    .register({ name: 'render',               deps: ['persist'],              handler: render.run });

  const results = await dag.run(ctx);
  return results['render'] as { shortId: string };
}
