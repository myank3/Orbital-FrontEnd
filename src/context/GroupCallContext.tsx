import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useGroupCall } from '../hooks/useGroupCall';
import { useAuth } from './AuthContext';

type GroupCallApi = ReturnType<typeof useGroupCall> & {
  activeCallGroupId: number | null;
  activeGroupName: string | null;
  joinForGroup: (groupId: number, groupName?: string) => Promise<void>;
  setGroupName: (name: string) => void;
};

const GroupCallContext = createContext<GroupCallApi | null>(null);

export function GroupCallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeCallGroupId, setActiveCallGroupId] = useState<number | null>(null);
  const [activeGroupName, setActiveGroupName] = useState<string | null>(null);

  const call = useGroupCall(
    activeCallGroupId ?? undefined,
    user ? { id: user.id, displayName: user.displayName ?? '' } : undefined,
    activeGroupName ?? undefined,
  );

  useEffect(() => {
    if (!call.inCall && activeCallGroupId != null) {
      setActiveCallGroupId(null);
      setActiveGroupName(null);
    }
  }, [call.inCall, activeCallGroupId]);

  const joinForGroup = useCallback(async (groupId: number, groupName?: string) => {
    setActiveCallGroupId(groupId);
    setActiveGroupName(groupName ?? null);
    await new Promise((r) => setTimeout(r, 50));
    await call.join();
  }, [call]);

  const setGroupName = useCallback((name: string) => {
    setActiveGroupName(name);
  }, []);

  return (
    <GroupCallContext.Provider
      value={{ ...call, activeCallGroupId, activeGroupName, joinForGroup, setGroupName }}
    >
      {children}
    </GroupCallContext.Provider>
  );
}

export function useGroupCallContext(): GroupCallApi {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error('useGroupCallContext must be used inside <GroupCallProvider>');
  return ctx;
}