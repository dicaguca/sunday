import { useState, useEffect, useRef } from 'react';
import {
    Plus, Trash2, Check, Sparkles,
    CalendarDays, Settings, RefreshCw,
} from 'lucide-react';
import { Modal } from './components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const CLOUD_SYNC_URL = 'https://api.sadhanas.app/sunday';
const PICK_COUNT     = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

// Returns e.g. "2026-W25"
const getWeekKey = () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

// Returns "Jun 16 – Jun 22" for a given week key
const weekRangeLabel = (weekKey) => {
    const [year, w] = weekKey.split('-W');
    const jan4  = new Date(parseInt(year), 0, 4);
    const mon   = new Date(jan4);
    mon.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + (parseInt(w) - 1) * 7);
    const sun   = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt   = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(mon)} – ${fmt(sun)}`;
};

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
    const weekKey = getWeekKey();

    // ── State ──────────────────────────────────────────────────────────────
    const [activities, setActivities] = useState(() => {
        const s = localStorage.getItem('sunday-activities');
        return s ? JSON.parse(s) : [];
    });

    // queue: shuffled remaining activity ids (next to be picked)
    const [queue, setQueue] = useState(() => {
        const s = localStorage.getItem('sunday-queue');
        return s ? JSON.parse(s) : [];
    });

    // sessions: [{ week, pickedIds, completedIds }]
    const [sessions, setSessions] = useState(() => {
        const s = localStorage.getItem('sunday-sessions');
        return s ? JSON.parse(s) : [];
    });

    const [activeTab,        setActiveTab]        = useState('week');
    const [showAddModal,     setShowAddModal]      = useState(false);
    const [newName,          setNewName]           = useState('');
    const [deleteTarget,     setDeleteTarget]      = useState(null);
    const [showRepickModal,  setShowRepickModal]   = useState(false);

    // ── Cloud sync ─────────────────────────────────────────────────────────
    const [syncStatus, setSyncStatus] = useState('Cloud sync ready');
    const [isSyncing,  setIsSyncing]  = useState(false);
    const cloudLoadedRef = useRef(false);
    const cloudTimerRef  = useRef(null);

    const getPayload = () => ({ activities, queue, sessions, updatedAt: new Date().toISOString() });

    const saveToCloud = async ({ manual = false } = {}) => {
        try {
            if (manual) setIsSyncing(true);
            setSyncStatus('Saving…');
            const res = await fetch(CLOUD_SYNC_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getPayload()),
            });
            if (!res.ok) throw new Error();
            setSyncStatus('Saved ✓');
            setTimeout(() => setSyncStatus('Cloud sync ready'), 3000);
        } catch {
            setSyncStatus('Save failed');
            setTimeout(() => setSyncStatus('Cloud sync ready'), 4000);
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
                if (Array.isArray(data.activities)) setActivities(data.activities);
                if (Array.isArray(data.queue))      setQueue(data.queue);
                if (Array.isArray(data.sessions))   setSessions(data.sessions);
            }
            setSyncStatus('Synced ✓');
            setTimeout(() => setSyncStatus('Cloud sync ready'), 3000);
        } catch {
            setSyncStatus('Offline mode');
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

    useEffect(() => localStorage.setItem('sunday-activities', JSON.stringify(activities)), [activities]);
    useEffect(() => localStorage.setItem('sunday-queue',      JSON.stringify(queue)),      [queue]);
    useEffect(() => localStorage.setItem('sunday-sessions',   JSON.stringify(sessions)),   [sessions]);

    // ── Rotation logic ─────────────────────────────────────────────────────

    // Pick the next PICK_COUNT activities from the queue (refilling as needed).
    // Returns { picked: id[], nextQueue: id[] }
    const drawFromQueue = (currentQueue) => {
        const validIds = new Set(activities.map(a => a.id));

        // Remove deleted activities from queue
        let q = currentQueue.filter(id => validIds.has(id));

        // Insert newly added activities (not yet in the queue) shuffled at the end
        const inQ    = new Set(q);
        const newOnes = shuffle(activities.filter(a => !inQ.has(a.id)).map(a => a.id));
        q = [...q, ...newOnes];

        const count = Math.min(PICK_COUNT, activities.length);

        // If we don't have enough, append a fresh shuffled cycle
        while (q.length < count) {
            q = [...q, ...shuffle(activities.map(a => a.id))];
        }

        const picked    = q.slice(0, count);
        let   remaining = q.slice(count);

        // When the queue empties, pre-fill the next cycle
        if (remaining.length === 0) {
            remaining = shuffle(activities.map(a => a.id));
        }

        return { picked, nextQueue: remaining };
    };

    const pickThisWeek = () => {
        const { picked, nextQueue } = drawFromQueue(queue);
        const session = { week: weekKey, pickedIds: picked, completedIds: [] };
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
        const a = { id: crypto.randomUUID(), name: newName.trim() };
        setActivities(prev => [...prev, a]);
        // Append to queue so it enters the rotation promptly
        setQueue(prev => [...prev, a.id]);
        setNewName('');
        setShowAddModal(false);
    };

    const deleteActivity = (id) => {
        setActivities(prev => prev.filter(a => a.id !== id));
        setQueue(prev => prev.filter(q => q !== id));
        setDeleteTarget(null);
    };

    // How many weeks until everything's been covered once
    const cycleWeeks = activities.length > 0
        ? Math.ceil(activities.length / PICK_COUNT)
        : 0;

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-gradient-to-br from-brand-sky via-brand-blue to-brand-purple p-4 pb-10">
            <div className="max-w-lg mx-auto">

                {/* ── Header ── */}
                <div className="text-center mb-5 pt-4">
                    <h1 className="text-2xl font-semibold tracking-wider uppercase text-white mb-1">
                        Sunday
                    </h1>
                    <div className="flex items-center justify-center gap-2 text-white">
                        <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-brand-yellow animate-pulse' : 'bg-white opacity-40'}`} />
                        <span className="text-xs opacity-60">{syncStatus}</span>
                        <button
                            onClick={() => saveToCloud({ manual: true })}
                            className="text-xs opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
                        >
                            sync now
                        </button>
                    </div>
                </div>

                {/* ── Tabs ── */}
                <div className="glass rounded-2xl p-1.5 mb-4 flex gap-1">
                    {[
                        { key: 'week',       label: 'This Week',  Icon: CalendarDays },
                        { key: 'activities', label: 'Activities', Icon: Settings },
                    ].map(({ key, label, Icon }) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`flex-1 py-2 px-2 rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-1.5 ${
                                activeTab === key
                                    ? 'bg-gradient-to-r from-brand-sky to-brand-blue text-white shadow-sm font-semibold'
                                    : 'text-stone-500 hover:text-stone-700 font-medium'
                            }`}
                        >
                            <Icon size={15} />
                            {label}
                        </button>
                    ))}
                </div>

                {/* ══════════════════════════════════════════════
                    THIS WEEK TAB
                ══════════════════════════════════════════════ */}
                {activeTab === 'week' && (
                    <div className="fade-in space-y-3">

                        {/* Week label */}
                        <div className="text-center">
                            <span className="text-xs text-white opacity-60 uppercase tracking-widest">
                                {weekRangeLabel(weekKey)}
                            </span>
                        </div>

                        {/* No activities yet */}
                        {activities.length === 0 && (
                            <div className="glass rounded-2xl p-10 text-center">
                                <Sparkles size={40} className="mx-auto mb-3 text-stone-300" />
                                <p className="font-semibold text-stone-600 mb-1">Pool is empty</p>
                                <p className="text-stone-400 text-sm mb-5">
                                    Add your cleaning tasks in the Activities tab first
                                </p>
                                <button
                                    onClick={() => setActiveTab('activities')}
                                    className="bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold px-6 py-2.5 rounded-xl text-sm"
                                >
                                    Go to Activities →
                                </button>
                            </div>
                        )}

                        {/* Ready to pick */}
                        {activities.length > 0 && !hasPicked && (
                            <div className="glass rounded-2xl p-8 text-center">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-sky to-brand-blue flex items-center justify-center mx-auto mb-5 shadow-lg">
                                    <Sparkles size={28} className="text-white" />
                                </div>
                                <p className="font-semibold text-stone-700 text-lg mb-2">
                                    What to clean this week?
                                </p>
                                <p className="text-stone-400 text-sm mb-1">
                                    {activities.length} tasks in the pool
                                </p>
                                <p className="text-stone-400 text-xs mb-7">
                                    Everything gets covered every ~{cycleWeeks} week{cycleWeeks !== 1 ? 's' : ''}
                                </p>
                                <button
                                    onClick={pickThisWeek}
                                    className="bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold px-8 py-3.5 rounded-2xl text-base hover:shadow-lg transition-all active:scale-[0.98] w-full"
                                >
                                    Pick this week's 3 tasks
                                </button>
                            </div>
                        )}

                        {/* Tasks picked */}
                        {hasPicked && (
                            <>
                                {/* Progress bar */}
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
                                    {thisSession.pickedIds.map((id) => {
                                        const activity = activities.find(a => a.id === id);
                                        const done     = thisSession.completedIds.includes(id);
                                        const name     = activity?.name ?? '(removed)';
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => activity && toggleComplete(id)}
                                                disabled={!activity}
                                                className={`w-full glass rounded-2xl px-5 py-4 flex items-center gap-4 transition-all duration-200 text-left ${
                                                    done          ? 'opacity-50'
                                                    : !activity   ? 'opacity-30 cursor-default'
                                                    : 'hover:shadow-md active:scale-[0.99]'
                                                }`}
                                            >
                                                {/* Icon bubble */}
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

                                                {/* Name */}
                                                <span className={`flex-1 font-medium text-base leading-snug ${
                                                    done ? 'line-through text-stone-300' : 'text-stone-700'
                                                }`}>
                                                    {name}
                                                </span>

                                                {done && (
                                                    <span className="text-xs text-brand-blue shrink-0">Done</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Re-pick link */}
                                <div className="text-center pt-1">
                                    <button
                                        onClick={() => setShowRepickModal(true)}
                                        className="inline-flex items-center gap-1.5 text-xs text-white opacity-45 hover:opacity-75 transition-opacity"
                                    >
                                        <RefreshCw size={11} />
                                        Pick different tasks
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ══════════════════════════════════════════════
                    ACTIVITIES TAB
                ══════════════════════════════════════════════ */}
                {activeTab === 'activities' && (
                    <div className="fade-in">
                        <div className="glass rounded-2xl p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="font-semibold text-stone-600 text-base">Cleaning Pool</h3>
                                    {activities.length > 0 && (
                                        <p className="text-xs text-stone-400 mt-0.5">
                                            {activities.length} tasks · full rotation every ~{cycleWeeks} week{cycleWeeks !== 1 ? 's' : ''}
                                        </p>
                                    )}
                                </div>
                                <button
                                    onClick={() => { setNewName(''); setShowAddModal(true); }}
                                    className="bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold px-4 py-2 rounded-xl text-sm flex items-center gap-1.5"
                                >
                                    <Plus size={15} /> Add
                                </button>
                            </div>

                            {activities.length === 0 ? (
                                <div className="text-center py-8 text-stone-400">
                                    <Sparkles size={36} className="mx-auto mb-3 text-stone-300" />
                                    <p className="font-medium">No tasks yet</p>
                                    <p className="text-sm mt-1">Tap Add to build your cleaning pool</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {activities.map((activity) => {
                                        // How many picks away is this activity?
                                        const qPos = queue.indexOf(activity.id);
                                        return (
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
                                                    <span className="text-stone-700 font-medium truncate">{activity.name}</span>
                                                </div>
                                                <button
                                                    onClick={() => setDeleteTarget(activity)}
                                                    className="p-2 hover:bg-red-100 rounded-lg text-stone-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-2 shrink-0"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Add Activity Modal ── */}
            <Modal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                title="Add to Pool"
                maxWidth="max-w-sm"
            >
                <div className="space-y-4">
                    <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addActivity()}
                        placeholder="e.g. Clean bathroom sink"
                        autoFocus
                        className="w-full border-2 border-stone-200 rounded-xl py-2.5 px-3 focus:outline-none focus:border-brand-blue font-medium text-stone-700 placeholder:text-stone-300 transition-colors"
                    />
                    <button
                        onClick={addActivity}
                        disabled={!newName.trim()}
                        className="w-full bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold py-3 rounded-xl disabled:opacity-40 hover:shadow-md transition-all"
                    >
                        Add Task
                    </button>
                </div>
            </Modal>

            {/* ── Delete Confirm Modal ── */}
            <Modal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Remove from Pool?"
                maxWidth="max-w-sm"
            >
                <div className="text-center">
                    <p className="font-semibold text-stone-700 mb-1">{deleteTarget?.name}</p>
                    <p className="text-stone-400 text-sm mb-6">
                        This task will no longer appear in future picks.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setDeleteTarget(null)}
                            className="flex-1 border-2 border-stone-200 rounded-xl py-3 text-stone-500 hover:bg-stone-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => deleteActivity(deleteTarget.id)}
                            className="flex-1 bg-gradient-to-r from-brand-salmon to-brand-pink text-white font-semibold py-3 rounded-xl hover:shadow-md transition-all"
                        >
                            Remove
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ── Re-pick Confirm Modal ── */}
            <Modal
                isOpen={showRepickModal}
                onClose={() => setShowRepickModal(false)}
                title="Pick different tasks?"
                maxWidth="max-w-sm"
            >
                <div className="text-center">
                    <p className="text-stone-400 text-sm mb-6">
                        This replaces this week's selection. Any tasks you've already checked off will be reset.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowRepickModal(false)}
                            className="flex-1 border-2 border-stone-200 rounded-xl py-3 text-stone-500 hover:bg-stone-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => { pickThisWeek(); setShowRepickModal(false); }}
                            className="flex-1 bg-gradient-to-r from-brand-sky to-brand-blue text-white font-semibold py-3 rounded-xl hover:shadow-md transition-all"
                        >
                            Pick again
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

export default App;
