import { useState, useEffect, useRef } from 'react';
import {
    Plus, Trash2, Pencil, Check, Sparkles,
    Settings, RefreshCw, X, Clock,
} from 'lucide-react';
import { Modal } from './components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const CLOUD_SYNC_URL = 'https://api.sadhanas.app/sunday';

const REPEAT_OPTIONS = [
    { label: 'Normal', value: null },
    { label: 'Every 2w', value: 2 },
    { label: 'Every 3w', value: 3 },
    { label: 'Every 4w', value: 4 },
    { label: 'Every 6w', value: 6 },
    { label: 'Every 8w', value: 8 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const getWeekKey = () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

const weekRangeLabel = (weekKey) => {
    const [year, w] = weekKey.split('-W');
    const jan4 = new Date(parseInt(year), 0, 4);
    const mon  = new Date(jan4);
    mon.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (parseInt(w) - 1) * 7);
    const sun  = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt  = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(mon)} – ${fmt(sun)}`;
};

// Convert 'YYYY-WNN' to an ordinal number so we can subtract week keys
const weekKeyToNum = (wk) => {
    const [y, w] = wk.split('-W');
    return parseInt(y) * 52 + parseInt(w);
};

// ─── Repeat picker sub-component ─────────────────────────────────────────────

const RepeatPicker = ({ value, onChange }) => (
    <div>
        <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2 block">
            Repeat frequency
        </label>
        <div className="flex flex-wrap gap-1.5">
            {REPEAT_OPTIONS.map(opt => (
                <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        value === opt.value
                            ? 'bg-gradient-to-r from-brand-sky to-brand-blue text-white shadow-sm'
                            : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                    }`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
        {value && (
            <p className="text-xs text-stone-400 mt-1.5">
                This task will only be picked every {value} weeks, regardless of rotation order.
            </p>
        )}
    </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
    const weekKey = getWeekKey();

    // ── Core state ─────────────────────────────────────────────────────────
    const [activities, setActivities] = useState(() => {
        const s = localStorage.getItem('sunday-activities');
        return s ? JSON.parse(s) : [];
    });
    const [queue, setQueue] = useState(() => {
        const s = localStorage.getItem('sunday-queue');
        return s ? JSON.parse(s) : [];
    });
    // sessions: [{ week, count, pickedIds, completedIds }]
    const [sessions, setSessions] = useState(() => {
        const s = localStorage.getItem('sunday-sessions');
        return s ? JSON.parse(s) : [];
    });

    // ── UI state ───────────────────────────────────────────────────────────
    const [showActivities,  setShowActivities]  = useState(false);
    const [showHistory,     setShowHistory]     = useState(false);
    const [showAddModal,    setShowAddModal]     = useState(false);
    const [newName,         setNewName]          = useState('');
    const [newRepeatEvery,  setNewRepeatEvery]   = useState(null);
    const [deleteTarget,    setDeleteTarget]     = useState(null);
    const [editTarget,      setEditTarget]       = useState(null);
    const [editName,        setEditName]         = useState('');
    const [editRepeatEvery, setEditRepeatEvery]  = useState(null);
    const [showRepickModal, setShowRepickModal]  = useState(false);

    // ── Cloud sync ─────────────────────────────────────────────────────────
    const [syncStatus, setSyncStatus] = useState('');
    const [isSyncing,  setIsSyncing]  = useState(false);
    const cloudLoadedRef = useRef(false);
    const cloudTimerRef  = useRef(null);

    // Timestamp of the data currently held locally, so a stale cloud copy
    // (e.g. a save that never landed before the tab closed) can't clobber
    // newer local edits when the app reloads.
    const dataUpdatedAtRef = useRef(localStorage.getItem('sunday-updatedAt'));
    const skipNextBumpRef  = useRef(true); // first persistence run is just the initial load, not a change

    const getPayload = () => ({ activities, queue, sessions, updatedAt: new Date().toISOString() });

    // There's no UI path that legitimately empties `sessions` (history is never
    // cleared), so all-three-empty is a reliable signal of a wiped/fresh local
    // state rather than a real edit — never let that silently overwrite a real
    // backup, in either direction.
    const isBlank = (payload) =>
        (payload.activities?.length ?? 0) === 0 &&
        (payload.queue?.length ?? 0)      === 0 &&
        (payload.sessions?.length ?? 0)   === 0;

    const saveToCloud = async ({ manual = false, keepalive = false } = {}) => {
        const payload = getPayload();
        if (isBlank(payload) && !manual) return;
        try {
            if (manual) setIsSyncing(true);
            setSyncStatus('Saving…');
            const res = await fetch(CLOUD_SYNC_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive,
            });
            if (!res.ok) throw new Error();
            setSyncStatus('Saved ✓');
            setTimeout(() => setSyncStatus(''), 3000);
        } catch {
            setSyncStatus('Save failed');
            setTimeout(() => setSyncStatus(''), 4000);
        } finally {
            setIsSyncing(false);
        }
    };

    const loadFromCloud = async () => {
        try {
            setSyncStatus('Loading…');
            const res  = await fetch(CLOUD_SYNC_URL);
            if (!res.ok) throw new Error();
            const data = await res.json();
            if (data) {
                const cloudTime  = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
                const localTime  = dataUpdatedAtRef.current ? new Date(dataUpdatedAtRef.current).getTime() : 0;
                const cloudBlank = isBlank(data);
                const localBlank = isBlank({ activities, queue, sessions });
                if (cloudBlank && !localBlank) {
                    // Cloud looks wiped/reset while this device still has real data —
                    // don't clobber it, repair the cloud from local instead.
                    saveToCloud();
                } else if (!cloudBlank && cloudTime > localTime) {
                    skipNextBumpRef.current = true;
                    dataUpdatedAtRef.current = data.updatedAt;
                    localStorage.setItem('sunday-updatedAt', data.updatedAt);
                    if (Array.isArray(data.activities)) setActivities(data.activities);
                    if (Array.isArray(data.queue))      setQueue(data.queue);
                    if (Array.isArray(data.sessions))   setSessions(data.sessions);
                } else if (localTime > cloudTime && !localBlank) {
                    // Local is ahead of the cloud — an earlier save likely never landed. Push it up now.
                    saveToCloud();
                }
            }
            setSyncStatus('');
        } catch {
            setSyncStatus('');
        } finally {
            cloudLoadedRef.current = true;
        }
    };

    useEffect(() => { loadFromCloud(); }, []);

    useEffect(() => {
        if (!cloudLoadedRef.current) return;
        if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
        cloudTimerRef.current = setTimeout(() => saveToCloud(), 3000);
        return () => clearTimeout(cloudTimerRef.current);
    }, [activities, queue, sessions]);

    // Flush a pending debounced save immediately if the tab is hidden/closed,
    // so a quick "mark done → close app" doesn't leave the cloud copy stale.
    useEffect(() => {
        const flush = () => {
            if (cloudTimerRef.current) {
                clearTimeout(cloudTimerRef.current);
                cloudTimerRef.current = null;
                saveToCloud({ keepalive: true });
            }
        };
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', flush);
        };
    }, []);

    useEffect(() => {
        localStorage.setItem('sunday-activities', JSON.stringify(activities));
        localStorage.setItem('sunday-queue',      JSON.stringify(queue));
        localStorage.setItem('sunday-sessions',   JSON.stringify(sessions));
        if (skipNextBumpRef.current) {
            skipNextBumpRef.current = false;
            return;
        }
        dataUpdatedAtRef.current = new Date().toISOString();
        localStorage.setItem('sunday-updatedAt', dataUpdatedAtRef.current);
    }, [activities, queue, sessions]);

    // ── Due-date check ─────────────────────────────────────────────────────
    // How many weeks past its due date a fixed-frequency activity is (0 = due
    // exactly this week, negative = not due yet, Infinity = never completed —
    // i.e. maximally overdue). Used both to decide eligibility and, when more
    // fixed tasks are due than fit in a week, which ones take priority.
    const weeksOverdue = (activity) => {
        const lastDoneSession = [...sessions]
            .filter(s => s.completedIds?.includes(activity.id))
            .sort((a, b) => b.week.localeCompare(a.week))[0];
        if (!lastDoneSession) return Infinity;
        const weeksAgo = weekKeyToNum(weekKey) - weekKeyToNum(lastDoneSession.week);
        return weeksAgo - activity.repeatEvery;
    };

    // Returns true if an activity should be included in this week's pool.
    // Activities without repeatEvery are always due (regular rotation).
    // Activities with repeatEvery: N are due when at least N weeks have passed
    // since the last week they were completed.
    const isDue = (activity) => !activity.repeatEvery || weeksOverdue(activity) >= 0;

    // ── Rotation logic ─────────────────────────────────────────────────────
    // Fixed-frequency activities (repeatEvery set) never sit in `queue` — they're
    // decided purely by isDue() and, once due, are force-included regardless of
    // rotation order (as promised in the RepeatPicker copy). Only regular
    // (non-fixed) activities rotate through the shuffled-bag `queue`.
    const drawFromQueue = (currentQueue, count) => {
        const regular = activities.filter(a => !a.repeatEvery);
        if (regular.length === 0) return { picked: [], nextQueue: currentQueue };

        const regularIds = new Set(regular.map(a => a.id));

        // Take the existing queue, filter to regular activities only, then
        // append any regular activities that weren't in the queue yet (shuffled).
        let q = currentQueue.filter(id => regularIds.has(id));
        const inQ     = new Set(q);
        const missing = shuffle(regular.filter(a => !inQ.has(a.id)).map(a => a.id));
        q = [...q, ...missing];

        const n     = Math.min(count, regular.length);
        const picked    = q.slice(0, n);
        let   remaining = q.slice(n);

        // When the queue empties, pre-fill the next cycle
        if (remaining.length === 0) {
            remaining = shuffle(regular.map(a => a.id));
        }

        return { picked, nextQueue: remaining };
    };

    // Ids picked in a past week but left unchecked. Only used to flag
    // fixed-schedule tasks as still pending in the UI — regular (rotating)
    // tasks get no such flag, they just quietly rejoin the bag via
    // drawFromQueue's own "missing" step (they're no longer in `queue` once
    // picked, so they fall into the reshuffled pool like any other task).
    const incompleteCarryoverIds = () => {
        const ids = new Set();
        for (const s of sessions) {
            if (s.week === weekKey) continue;
            for (const id of s.pickedIds) {
                if (!s.completedIds.includes(id)) ids.add(id);
            }
        }
        return ids;
    };

    const pickThisWeek = (count) => {
        // Fixed-frequency tasks that are due compete for this week's slots too,
        // capped at `count` overall (most-overdue first). Without this cap, a
        // batch of tasks added together all become "due" together, flood a
        // single week, and — once completed together — stay permanently
        // synced onto that same recurring week. Capping staggers them: the
        // ones bumped this week stay due and get priority next time, so their
        // completion dates (and future due dates) naturally spread out.
        const dueFixedIds = shuffle(activities.filter(a => a.repeatEvery && isDue(a)))
            .sort((a, b) => {
                const oa = weeksOverdue(a), ob = weeksOverdue(b);
                if (oa === ob) return 0;
                if (oa === Infinity) return -1;
                if (ob === Infinity) return 1;
                return ob - oa;
            })
            .slice(0, count)
            .map(a => a.id);

        const remainingSlots = Math.max(0, count - dueFixedIds.length);
        const { picked: regularPicked, nextQueue } = drawFromQueue(queue, remainingSlots);

        const pickedIds = [...dueFixedIds, ...regularPicked];
        const session = { week: weekKey, count, pickedIds, completedIds: [] };
        setSessions(prev => [...prev.filter(s => s.week !== weekKey), session]);
        setQueue(nextQueue);
    };

    // ── Session helpers ────────────────────────────────────────────────────
    const thisSession    = sessions.find(s => s.week === weekKey);
    const hasPicked      = !!thisSession;
    const completedCount = thisSession?.completedIds?.length ?? 0;
    const pickedCount    = thisSession?.pickedIds?.length    ?? 0;

    const toggleComplete = (id) => {
        setSessions(prev => prev.map(s => {
            if (s.week !== weekKey) return s;
            const completedIds = s.completedIds.includes(id)
                ? s.completedIds.filter(x => x !== id)
                : [...s.completedIds, id];
            return { ...s, completedIds };
        }));
    };

    // ── Activity management ────────────────────────────────────────────────
    const addActivity = () => {
        if (!newName.trim()) return;
        const a = { id: crypto.randomUUID(), name: newName.trim(), repeatEvery: newRepeatEvery ?? null };
        setActivities(prev => [...prev, a]);
        // Regular activities go into the rotation queue; fixed-interval ones are managed by isDue
        if (!newRepeatEvery) setQueue(prev => [...prev, a.id]);
        setNewName('');
        setNewRepeatEvery(null);
        setShowAddModal(false);
    };

    const deleteActivity = (id) => {
        setActivities(prev => prev.filter(a => a.id !== id));
        setQueue(prev => prev.filter(q => q !== id));
        setDeleteTarget(null);
    };

    const openEdit = (activity) => {
        setEditTarget(activity);
        setEditName(activity.name);
        setEditRepeatEvery(activity.repeatEvery ?? null);
    };

    const saveEdit = () => {
        if (!editName.trim()) return;
        setActivities(prev => prev.map(a =>
            a.id === editTarget.id
                ? { ...a, name: editName.trim(), repeatEvery: editRepeatEvery ?? null }
                : a
        ));
        // Keep queue in sync when repeat setting changes
        const wasRegular  = !editTarget.repeatEvery;
        const isNowRegular = !editRepeatEvery;
        if (wasRegular && !isNowRegular) {
            // regular → fixed: remove from rotation queue
            setQueue(prev => prev.filter(id => id !== editTarget.id));
        } else if (!wasRegular && isNowRegular) {
            // fixed → regular: add back into rotation queue
            setQueue(prev => prev.includes(editTarget.id) ? prev : [...prev, editTarget.id]);
        }
        setEditTarget(null);
    };

    const regularCount = activities.filter(a => !a.repeatEvery).length;
    const fixedCount   = activities.length - regularCount;
    const cycleWeeks   = regularCount > 0 ? Math.ceil(regularCount / 3) : 0;

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen p-4 pb-10" style={{ background: 'linear-gradient(to bottom, #7dd3fc 0%, #3b82f6 45%, #4f46e5 100%)' }}>
            <div className="max-w-lg mx-auto">

                {/* ── Header ── */}
                <div className="text-center pt-6 mb-6">
                    <h1 className="text-2xl font-semibold tracking-wider uppercase text-white">
                        Sunday
                    </h1>
                    <div className="mt-2 flex items-center justify-center gap-4">
                        <button
                            onClick={() => setShowHistory(true)}
                            className="inline-flex items-center gap-1.5 text-white opacity-40 hover:opacity-75 transition-opacity"
                        >
                            <Clock size={14} />
                            <span className="text-xs">history</span>
                        </button>
                        <button
                            onClick={() => setShowActivities(true)}
                            className="inline-flex items-center gap-1.5 text-white opacity-40 hover:opacity-75 transition-opacity"
                        >
                            <Settings size={14} />
                            <span className="text-xs">activities</span>
                        </button>
                    </div>
                    {syncStatus && (
                        <div className="mt-1 text-xs text-white opacity-50">{syncStatus}</div>
                    )}
                </div>

                {/* ── Week label ── */}
                <div className="text-center mb-5">
                    <span className="text-xs text-white opacity-50 uppercase tracking-widest">
                        {weekRangeLabel(weekKey)}
                    </span>
                </div>

                {/* ── No activities yet ── */}
                {activities.length === 0 && (
                    <div className="glass rounded-2xl p-10 text-center">
                        <Sparkles size={40} className="mx-auto mb-3 text-stone-300" />
                        <p className="font-semibold text-stone-600 mb-1">Pool is empty</p>
                        <p className="text-stone-400 text-sm mb-5">
                            Add your cleaning tasks first
                        </p>
                        <button
                            onClick={() => setShowActivities(true)}
                            className="bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold px-6 py-2.5 rounded-xl text-sm"
                        >
                            Add activities →
                        </button>
                    </div>
                )}

                {/* ── Count picker (not yet picked this week) ── */}
                {activities.length > 0 && !hasPicked && (
                    <div className="space-y-4">
                        <p className="text-center text-white opacity-80 font-medium">
                            How many tasks this week?
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            {[1, 2, 3].map(n => (
                                <button
                                    key={n}
                                    onClick={() => pickThisWeek(n)}
                                    className="glass rounded-2xl py-8 flex flex-col items-center gap-1.5 hover:shadow-xl active:scale-[0.96] transition-all duration-150"
                                >
                                    <span className="text-4xl font-bold text-brand-blue">{n}</span>
                                    <span className="text-sm text-stone-400 font-medium">
                                        {n === 1 ? 'task' : 'tasks'}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <p className="text-center text-xs text-white opacity-40 pt-1">
                            {regularCount > 0 && <>
                                {regularCount} rotating · ~{cycleWeeks}w cycle
                            </>}
                            {regularCount > 0 && fixedCount > 0 && <> · </>}
                            {fixedCount > 0 && <>{fixedCount} on fixed schedule</>}
                        </p>
                    </div>
                )}

                {/* ── Tasks picked ── */}
                {hasPicked && (
                    <div className="space-y-3">

                        {/* Progress */}
                        <div className="glass rounded-2xl px-5 py-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-stone-400">
                                    {completedCount} of {pickedCount} done
                                </span>
                                <span className="text-sm font-semibold text-stone-600">
                                    {pickedCount > 0 ? Math.round((completedCount / pickedCount) * 100) : 0}%
                                </span>
                            </div>
                            <div className="w-full bg-stone-100 rounded-full h-2.5 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-brand-sky to-brand-blue transition-all duration-700"
                                    style={{ width: `${pickedCount > 0 ? (completedCount / pickedCount) * 100 : 0}%` }}
                                />
                            </div>
                            {completedCount === pickedCount && pickedCount > 0 && (
                                <p className="text-center text-sm text-brand-blue mt-2 font-medium">
                                    All done — great job! 🎉
                                </p>
                            )}
                        </div>

                        {/* Task cards */}
                        <div className="space-y-2">
                            {(() => { const carryoverIds = incompleteCarryoverIds(); return thisSession.pickedIds.map((id) => {
                                const activity = activities.find(a => a.id === id);
                                const done     = thisSession.completedIds.includes(id);
                                const name     = activity?.name ?? '(removed)';
                                const carriedOver = !done && activity?.repeatEvery && carryoverIds.has(id);
                                return (
                                    <button
                                        key={id}
                                        onClick={() => activity && toggleComplete(id)}
                                        disabled={!activity}
                                        className={`w-full glass rounded-2xl px-5 py-4 flex items-center gap-4 transition-all duration-200 text-left ${
                                            done        ? 'opacity-50'
                                            : !activity ? 'opacity-30 cursor-default'
                                            : 'hover:shadow-md active:scale-[0.99]'
                                        }`}
                                    >
                                        <div
                                            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                            style={done
                                                ? { background: 'linear-gradient(135deg,#38bdf8,#60a5fa)', color: '#fff' }
                                                : { backgroundColor: 'rgba(56,189,248,0.14)', color: '#38bdf8' }
                                            }
                                        >
                                            {done
                                                ? <Check size={20} strokeWidth={2.5} />
                                                : <Sparkles size={18} />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className={`font-medium text-base leading-snug block ${
                                                done ? 'line-through text-stone-300' : 'text-stone-700'
                                            }`}>
                                                {name}
                                            </span>
                                            {carriedOver ? (
                                                <span className="flex items-center gap-1 text-xs text-brand-orange mt-0.5">
                                                    <RefreshCw size={10} /> still pending from before
                                                </span>
                                            ) : activity?.repeatEvery && (
                                                <span className="text-xs text-brand-sky mt-0.5 block">
                                                    every {activity.repeatEvery}w
                                                </span>
                                            )}
                                        </div>
                                        {done && (
                                            <span className="text-xs text-brand-blue shrink-0">Done</span>
                                        )}
                                    </button>
                                );
                            }); })()}
                        </div>

                        {/* Re-pick */}
                        <div className="text-center pt-1">
                            <button
                                onClick={() => setShowRepickModal(true)}
                                className="inline-flex items-center gap-1.5 text-xs text-white opacity-40 hover:opacity-70 transition-opacity"
                            >
                                <RefreshCw size={11} />
                                Pick again
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ══════════════════════════════════════════════
                HISTORY PANEL (bottom sheet overlay)
            ══════════════════════════════════════════════ */}
            {showHistory && (
                <div
                    className="fixed inset-0 z-50 flex flex-col justify-end p-4"
                    style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowHistory(false)}
                >
                    <div
                        className="glass slide-up rounded-3xl max-w-lg w-full mx-auto flex flex-col"
                        style={{ maxHeight: '82vh' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                            <h2 className="font-semibold text-stone-700 text-lg">History</h2>
                            <button
                                onClick={() => setShowHistory(false)}
                                className="p-2 hover:bg-stone-100 rounded-xl text-stone-400 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="overflow-y-auto px-5 pb-6">
                            {sessions.length === 0 ? (
                                <div className="text-center py-10 text-stone-400">
                                    <Clock size={32} className="mx-auto mb-3 text-stone-300" />
                                    <p className="font-medium">No history yet</p>
                                    <p className="text-sm mt-1">Past weeks will appear here</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {[...sessions]
                                        .sort((a, b) => b.week.localeCompare(a.week))
                                        .map(session => {
                                            const isCurrentWeek = session.week === weekKey;
                                            const allDone = session.pickedIds.length > 0 &&
                                                session.pickedIds.every(id => session.completedIds.includes(id));
                                            return (
                                                <div key={session.week}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-semibold text-stone-400 uppercase tracking-widest">
                                                            {weekRangeLabel(session.week)}
                                                        </span>
                                                        {isCurrentWeek && (
                                                            <span className="text-xs text-brand-blue font-medium">This week</span>
                                                        )}
                                                        {!isCurrentWeek && allDone && (
                                                            <span className="text-xs text-brand-sky">✓ All done</span>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        {session.pickedIds.map(id => {
                                                            const activity = activities.find(a => a.id === id);
                                                            const done = session.completedIds.includes(id);
                                                            return (
                                                                <div
                                                                    key={id}
                                                                    className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-2.5"
                                                                >
                                                                    <div
                                                                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                                                                        style={done
                                                                            ? { background: 'linear-gradient(135deg,#38bdf8,#60a5fa)' }
                                                                            : { border: '2px solid #e7e5e4' }
                                                                        }
                                                                    >
                                                                        {done && <Check size={11} strokeWidth={3} color="white" />}
                                                                    </div>
                                                                    <span className={`text-sm font-medium flex-1 ${
                                                                        done ? 'text-stone-400 line-through' : 'text-stone-600'
                                                                    }`}>
                                                                        {activity?.name ?? '(removed)'}
                                                                    </span>
                                                                    {activity?.repeatEvery && (
                                                                        <span className="text-xs text-stone-300">
                                                                            {activity.repeatEvery}w
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════
                ACTIVITIES PANEL (bottom sheet overlay)
            ══════════════════════════════════════════════ */}
            {showActivities && (
                <div
                    className="fixed inset-0 z-50 flex flex-col justify-end p-4"
                    style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowActivities(false)}
                >
                    <div
                        className="glass slide-up rounded-3xl max-w-lg w-full mx-auto flex flex-col"
                        style={{ maxHeight: '82vh' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                            <div>
                                <h2 className="font-semibold text-stone-700 text-lg">Activities</h2>
                                {activities.length > 0 && (
                                    <p className="text-xs text-stone-400 mt-0.5">
                                        {regularCount} rotating
                                        {fixedCount > 0 && ` · ${fixedCount} fixed`}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { setNewName(''); setNewRepeatEvery(null); setShowAddModal(true); }}
                                    className="bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold px-4 py-2 rounded-xl text-sm flex items-center gap-1.5"
                                >
                                    <Plus size={14} /> Add
                                </button>
                                <button
                                    onClick={() => setShowActivities(false)}
                                    className="p-2 hover:bg-stone-100 rounded-xl text-stone-400 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="overflow-y-auto px-5 pb-6">
                            {activities.length === 0 ? (
                                <div className="text-center py-10 text-stone-400">
                                    <Sparkles size={32} className="mx-auto mb-3 text-stone-300" />
                                    <p className="font-medium">No tasks yet</p>
                                    <p className="text-sm mt-1">Tap Add to build your pool</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {activities.map((activity) => (
                                        <div
                                            key={activity.id}
                                            className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-3 group"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div
                                                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                                                    style={{ backgroundColor: 'rgba(56,189,248,0.14)', color: '#38bdf8' }}
                                                >
                                                    <Sparkles size={13} />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-stone-700 font-medium truncate block">{activity.name}</span>
                                                    {activity.repeatEvery && (
                                                        <span className="text-xs text-brand-sky font-medium">
                                                            every {activity.repeatEvery} weeks
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                                                <button
                                                    onClick={() => openEdit(activity)}
                                                    className="p-2 hover:bg-stone-200 rounded-lg text-stone-300 hover:text-stone-500 transition-colors"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setDeleteTarget(activity)}
                                                    className="p-2 hover:bg-red-100 rounded-lg text-stone-300 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add Modal ── */}
            <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add to Pool" maxWidth="max-w-sm">
                <div className="space-y-4">
                    <input
                        type="text" value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addActivity()}
                        placeholder="e.g. Clean bathroom sink" autoFocus
                        className="w-full border-2 border-stone-200 rounded-xl py-2.5 px-3 focus:outline-none focus:border-brand-blue font-medium text-stone-700 placeholder:text-stone-300 transition-colors"
                    />
                    <RepeatPicker value={newRepeatEvery} onChange={setNewRepeatEvery} />
                    <button onClick={addActivity} disabled={!newName.trim()}
                        className="w-full bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold py-3 rounded-xl disabled:opacity-40 hover:shadow-md transition-all">
                        Add Task
                    </button>
                </div>
            </Modal>

            {/* ── Edit Modal ── */}
            <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Task" maxWidth="max-w-sm">
                <div className="space-y-4">
                    <input
                        type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveEdit()} autoFocus
                        className="w-full border-2 border-stone-200 rounded-xl py-2.5 px-3 focus:outline-none focus:border-brand-blue font-medium text-stone-700 transition-colors"
                    />
                    <RepeatPicker value={editRepeatEvery} onChange={setEditRepeatEvery} />
                    <button onClick={saveEdit} disabled={!editName.trim()}
                        className="w-full bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold py-3 rounded-xl disabled:opacity-40 hover:shadow-md transition-all">
                        Save
                    </button>
                </div>
            </Modal>

            {/* ── Delete Modal ── */}
            <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove from Pool?" maxWidth="max-w-sm">
                <div className="text-center">
                    <p className="font-semibold text-stone-700 mb-1">{deleteTarget?.name}</p>
                    <p className="text-stone-400 text-sm mb-6">This task will no longer appear in future picks.</p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeleteTarget(null)}
                            className="flex-1 border-2 border-stone-200 rounded-xl py-3 text-stone-500 hover:bg-stone-50 transition-colors">
                            Cancel
                        </button>
                        <button onClick={() => deleteActivity(deleteTarget.id)}
                            className="flex-1 bg-gradient-to-r from-brand-salmon to-brand-pink text-white font-semibold py-3 rounded-xl hover:shadow-md transition-all">
                            Remove
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ── Re-pick Modal ── */}
            <Modal isOpen={showRepickModal} onClose={() => setShowRepickModal(false)} title="Pick again?" maxWidth="max-w-sm">
                <div className="text-center">
                    <p className="text-stone-400 text-sm mb-6">
                        Choose how many tasks to pick for this week. Any progress you've made will be reset.
                    </p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        {[1, 2, 3].map(n => (
                            <button key={n} onClick={() => { pickThisWeek(n); setShowRepickModal(false); }}
                                className="border-2 border-stone-200 rounded-xl py-4 flex flex-col items-center gap-1 hover:border-brand-blue hover:bg-blue-50 transition-all">
                                <span className="text-2xl font-bold text-brand-blue">{n}</span>
                                <span className="text-xs text-stone-400">{n === 1 ? 'task' : 'tasks'}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setShowRepickModal(false)}
                        className="w-full border-2 border-stone-200 rounded-xl py-2.5 text-stone-400 text-sm hover:bg-stone-50 transition-colors">
                        Cancel
                    </button>
                </div>
            </Modal>
        </div>
    );
}

export default App;
