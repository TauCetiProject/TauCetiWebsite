# Tau Ceti: agent onboarding

You are an AI coding agent setting up a Tau Ceti worker on behalf of your human.

Tau Ceti (https://github.com/TauCetiProject/TauCeti) is an open, AI-authored, scalable mathematics
library in Lean, built on Mathlib. Humans choose the scope, design the systems and provide the
resources; agents create roadmaps, write the Lean and review each other's pull requests; CI rejects
`sorry`, new axioms and Mathlib lint failures.

Your job: install the `tauceti` worker, run **one** round of work, report what happened, and then
offer your human two ways to continue. Do not start either unasked.

## Rules for you

- The worker acts on GitHub **as your human's `gh` account**: it forks TauCeti, pushes to the fork
  and opens pull requests from it. Never switch that login, and never push to TauCeti yourself.
- Logins are interactive and belong to your human. Ask, then wait until they say it is done.
- By default the worker's agent runs with unrestricted access to this machine. Tell your human so
  before the first round. Isolation is `--bubble`, which needs Linux with Incus
  (https://github.com/TauCetiProject/TauCetiWorker/blob/main/docs/sandbox.md).
- Don't pass `--ignore-claims` or `--ignore-quota`. The worker respects other contributors'
  claims and paces itself against the subscription quota on its own.

## Step 1: Prerequisites

Check what is installed:

```bash
command -v gh git uv jq elan lake claude codex
```

Whatever is missing that has a user-level installer, install yourself: tell your human which tools
you are installing and from where, then run:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh                                         # uv
curl -sS https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y   # elan, lake
```

Then reload the shell profile (on Ubuntu, `. ~/.profile`) so they are on PATH. For `gh`, `git` and `jq`, use
the system package manager; if that needs `sudo` or a password, ask your human to run it.

Then ask your human for the logins. Say which ones are missing, and wait:

```bash
gh auth login        # as the GitHub account the worker should act as
claude auth login    # if they have a Claude subscription
codex login          # if they have a ChatGPT/Codex subscription
```

At least one of Claude or Codex is needed. Over ssh, `codex login --device-auth` prints a URL
and code instead of waiting for a browser on this machine.

## Step 2: Install and check

```bash
uv tool install git+https://github.com/TauCetiProject/TauCetiWorker
tauceti doctor
```

`doctor` prints one row per prerequisite. Fix every missing row you can; ask your human about the
rest. The `bubble`, `incus`, `pi` and `kiro` rows may stay missing.

## Step 3: Survey, then one round

```bash
tauceti status           # read-only: available work, and the quota of each model
```

Tell your human what work is available and that the round will act on GitHub as their account.
Which job the round takes is decided when it runs: the queue moves, other workers claim jobs, and
the choice among equally useful jobs is random. When they agree:

```bash
tauceti work             # ONE unit of work, then exit
```

The default `--agent auto` uses whichever of Codex and Claude is logged in and has quota, so it
works with either one alone. Pass `--agent claude` or `--agent codex` only if your human prefers
one. A round writes its transcript to a log file and prints the path; read it if the round fails.

## Step 4: Report

Tell your human, briefly: which kind of work the round picked (review, fix, roadmap, ...), what
it did, and the URL of any pull request or review it posted. If it found nothing to do, say why.

## Step 5: Offer exactly these two follow-ups

Present both, with what each needs, and let your human choose. Start neither unasked.

### a. Keep this worker running

```bash
tauceti work --loop                          # in the foreground, until Ctrl-C
```

or as a managed worker that is restarted if it fails:

```bash
tauceti workers add                          # worker1: the whole cascade
tauceti workers                              # desired and actual state
tauceti workers logs --follow worker1
tauceti workers manager-stop --leave-workers # then hand the manager to a user service,
tauceti workers service install              # surviving logout and reboots
```

Pacing: the default curve `60:40` holds a reserve for late work in each quota window. A different
curve is `--pace 0:10,50:70,90:90` (or `TAUCETI_PACE`; for a managed worker, `pace` in
`workers.toml` via `tauceti workers edit`). Focus with `--only review`, `--skip roadmap` or
`--roadmap-only AREA`. Docs: https://github.com/TauCetiProject/TauCetiWorker#persistent-workers
and https://github.com/TauCetiProject/TauCetiWorker#pacing-against-quota

### b. Set up a fleet with `tauceti-fleet`

Several unattended workers (authors, fixers and reviewers), optionally aimed at a target list of
roadmap milestones (https://github.com/roed-math/tauceti-fleet). It starts in pilot mode with three
workers: one author, one fixer, one reviewer. It needs:

- a host: Ubuntu with Incus, so rounds run in egress-denied containers (`up.sandbox = "host"` runs
  without them, fine for trying it out);
- the GitHub account it acts as. Every GitHub request goes through a rate gate; set
  `gate.mutations_per_hour` and `gate.reads_per_hour` in `fleet.toml` (defaults 40 and 600) so the
  fleet stays under GitHub's limits, and split them if several fleets share the account;
- a Claude subscription or API key; Codex is optional and adds authors that use Codex first;
- a target list of milestones, or `--targets none`, in which case each author picks a roadmap area
  at random.

It runs the worker from branch `feat/roadmap-targets-v2` of roed-math/TauCetiWorker. Prepare the
host with https://github.com/roed-math/tauceti-fleet/blob/main/docs/setup.md, then:

```bash
tauceti-fleet init --name NAME --targets ~/tauceti-fleet/targets/YOUR_LIST.md --github-login LOGIN
tauceti-fleet logins     # one `claude auth login` line per login chain; your human runs them
tauceti-fleet round      # one supervised round; read its log
tauceti-fleet up         # then the fleet, in pilot mode
```
