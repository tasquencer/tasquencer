import { Builder } from '../../../tasquencer'
import { createDealTask } from '../workItems/createDeal.workItem'
import { qualifyLeadTask } from '../workItems/qualifyLead.workItem'
import { disqualifyLeadTask } from '../workItems/disqualifyLead.workItem'
import { createEstimateTask } from '../workItems/createEstimate.workItem'
import { createProposalTask } from '../workItems/createProposal.workItem'
import { sendProposalTask } from '../workItems/sendProposal.workItem'
import { negotiateTermsTask } from '../workItems/negotiateTerms.workItem'
import { reviseProposalTask } from '../workItems/reviseProposal.workItem'
import { getProposalSignedTask } from '../workItems/getProposalSigned.workItem'
import { archiveDealTask } from '../workItems/archiveDeal.workItem'
import { getDealByWorkflowId } from '../db/deals'
import { getLatestProposalForDeal } from '../db/proposals'
import { assertDealExists } from '../exceptions'

const completeSalesTask = Builder.dummyTask()
export const salesPhaseWorkflow = Builder.workflow('salesPhase')
  .startCondition('start')
  .endCondition('end')
  .task('createDeal', createDealTask)
  .task('qualifyLead', qualifyLeadTask.withSplitType('xor'))
  .task('disqualifyLead', disqualifyLeadTask)
  .task('createEstimate', createEstimateTask)
  .task('createProposal', createProposalTask)
  .task('sendProposal', sendProposalTask.withJoinType('xor'))
  .task('negotiateTerms', negotiateTermsTask.withSplitType('xor'))
  .task('reviseProposal', reviseProposalTask)
  .task('getProposalSigned', getProposalSignedTask.withSplitType('xor'))
  .task('archiveDeal', archiveDealTask.withJoinType('xor'))
  .dummyTask('completeSales', completeSalesTask)
  .connectCondition('start', (to) => to.task('createDeal'))
  .connectTask('createDeal', (to) => to.task('qualifyLead'))
  .connectTask('qualifyLead', (to) =>
    to
      .task('createEstimate')
      .task('disqualifyLead')
      .route(async ({ mutationCtx, route, parent }) => {
        // Route based on deal stage set during qualifyLead completion
        const deal = await getDealByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertDealExists(deal, { workflowId: parent.workflow.id })

        // Qualified → continue to estimate, Disqualified → archive
        if (deal.stage === 'Qualified') {
          return route.toTask('createEstimate')
        }
        return route.toTask('disqualifyLead')
      })
  )
  .connectTask('disqualifyLead', (to) => to.task('archiveDeal'))
  .connectTask('createEstimate', (to) => to.task('createProposal'))
  .connectTask('createProposal', (to) => to.task('sendProposal'))
  .connectTask('sendProposal', (to) => to.task('negotiateTerms'))
  .connectTask('negotiateTerms', (to) =>
    to
      .task('getProposalSigned')
      .task('reviseProposal')
      .task('archiveDeal')
      .route(async ({ mutationCtx, route, parent }) => {
        // Route based on deal stage and proposal status
        const deal = await getDealByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertDealExists(deal, { workflowId: parent.workflow.id })

        // If deal was lost during negotiation, archive it
        if (deal.stage === 'Lost') {
          return route.toTask('archiveDeal')
        }

        // Check proposal status for revision vs signing
        const proposal = await getLatestProposalForDeal(mutationCtx.db, deal._id)
        if (proposal?.status === 'Rejected') {
          // Client rejected, needs revision
          return route.toTask('reviseProposal')
        }

        // Proceed to signature
        return route.toTask('getProposalSigned')
      })
  )
  // TODO: Consider looping revisions back through createEstimate for v2+ estimates.
  .connectTask('reviseProposal', (to) => to.task('sendProposal'))
  .connectTask('getProposalSigned', (to) =>
    to
      .task('completeSales')
      .task('archiveDeal')
      .route(async ({ mutationCtx, route, parent }) => {
        // Route based on deal stage set during getProposalSigned completion
        const deal = await getDealByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertDealExists(deal, { workflowId: parent.workflow.id })

        // Won → complete sales, Lost → archive
        if (deal.stage === 'Won') {
          return route.toTask('completeSales')
        }
        return route.toTask('archiveDeal')
      })
  )
  .connectTask('archiveDeal', (to) => to.condition('end'))
  .connectTask('completeSales', (to) => to.condition('end'))
