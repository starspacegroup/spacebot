/**
 * The gateway ran for hours without a channel sync that had already been
 * merged, because the deploy poller asked the wrong question. It compared the
 * checkout against the remote, which says nothing about whether the running
 * processes were ever replaced — and a deploy that fast-forwards and then dies
 * (a failing `db:migrate`, in that case) leaves those two equal. The poller
 * then saw nothing to do, and only a future commit could have rescued it.
 */
import { describe, expect, it } from 'vitest';
import { decideDeployAction } from '../../scripts/deploy-runner';

const OLD = 'aaaaaaa';
const NEW = 'bbbbbbb';

describe('decideDeployAction', () => {
	it('deploys when the checkout is behind, measured from the checkout', () => {
		expect(decideDeployAction(OLD, NEW, OLD)).toEqual({ stranded: false, since: OLD });
	});

	it('resumes a deploy that reached the checkout but never restarted', () => {
		// The merge landed, something after it threw. Nothing new will arrive to
		// carry it, so this has to be recognised on its own.
		expect(decideDeployAction(NEW, NEW, OLD)).toEqual({ stranded: true, since: OLD });
	});

	it('measures a resume from what last ran, not from the checkout', () => {
		// Otherwise the diff is empty and the resume skips install and migrate —
		// the two steps the stranded deploy most likely died in.
		expect(decideDeployAction(NEW, NEW, OLD)?.since).toBe(OLD);
	});

	it('does nothing when the box is running what it has checked out', () => {
		expect(decideDeployAction(NEW, NEW, NEW)).toBeNull();
	});

	it('does not treat a box that has never recorded a deploy as stranded', () => {
		// Every box is in this state the first time it runs this code. Calling it
		// stranded would restart all of them on upgrade for no reason.
		expect(decideDeployAction(NEW, NEW, null)).toBeNull();
	});
});
