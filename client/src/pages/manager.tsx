import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtimeWithFallback } from "@/hooks/use-realtime";
import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { GameTable, QueueEntry, Event } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Play,
  Square,
  ChevronUp,
  ChevronDown,
  XCircle,
  UserPlus,
  LogOut,
  Dice5,
  Users,
  Shield,
  AlertCircle,
  Settings2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

type QueueEntryEnriched = QueueEntry & { userName?: string; braceletId?: string };
type TableWithQueue = GameTable & { queueLength: number; queue: QueueEntry[] };

export default function ManagerPage() {
  const { user, logout, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [addUserDialog, setAddUserDialog] = useState(false);
  const [addBraceletId, setAddBraceletId] = useState("");
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [maxParallelGames, setMaxParallelGames] = useState(1);

  const { data: activeEvent } = useQuery<Event | null>({
    queryKey: ["/api/events/active"],
  });

  const activeEventId = activeEvent?.id || "";

  const { data: tables = [] } = useQuery<TableWithQueue[]>({
    queryKey: ["/api/events", activeEventId, "tables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${activeEventId}/tables`);
      return res.json();
    },
    enabled: !!activeEventId,
  });

  const { data: queueEntries = [], refetch: refetchQueue } = useQuery<QueueEntryEnriched[]>({
    queryKey: ["/api/tables", selectedTable, "queue"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tables/${selectedTable}/queue`);
      return res.json();
    },
    enabled: !!selectedTable,
  });

  // Supabase Realtime with fallback
  useRealtimeWithFallback({
    tables: ["queue_entries", "game_tables"],
    queryKeys: [
      ["/api/events", activeEventId, "tables"],
      ["/api/tables", selectedTable || "", "queue"],
    ],
    enabled: !!activeEventId,
  });

  const handleStartSession = async (tableId: string) => {
    try {
      await apiRequest("POST", `/api/tables/${tableId}/start-session`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", activeEventId, "tables"] });
      refetchQueue();
      toast({ title: "Партия начата" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleEndAllSessions = async (tableId: string) => {
    try {
      await apiRequest("POST", `/api/tables/${tableId}/end-session`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", activeEventId, "tables"] });
      refetchQueue();
      toast({ title: "Все партии завершены" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleEndOneSession = async (entryId: string) => {
    try {
      await apiRequest("POST", `/api/queue/${entryId}/end-session`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", activeEventId, "tables"] });
      refetchQueue();
      toast({ title: "Партия завершена" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleSkip = async (entryId: string) => {
    try {
      await apiRequest("POST", `/api/queue/${entryId}/skip`);
      refetchQueue();
      toast({ title: "Пользователь пропущен" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleMoveUp = async (entryIndex: number) => {
    if (entryIndex <= 0) return;
    const ids = queueEntries.map((e) => e.id);
    [ids[entryIndex - 1], ids[entryIndex]] = [ids[entryIndex], ids[entryIndex - 1]];
    try {
      await apiRequest("POST", `/api/tables/${selectedTable}/reorder`, { entryIds: ids });
      refetchQueue();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleMoveDown = async (entryIndex: number) => {
    if (entryIndex >= queueEntries.length - 1) return;
    const ids = queueEntries.map((e) => e.id);
    [ids[entryIndex], ids[entryIndex + 1]] = [ids[entryIndex + 1], ids[entryIndex]];
    try {
      await apiRequest("POST", `/api/tables/${selectedTable}/reorder`, { entryIds: ids });
      refetchQueue();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleForceAdd = async () => {
    if (!addBraceletId || !selectedTable) return;
    try {
      await apiRequest("POST", "/api/queue/force-add", {
        tableId: selectedTable,
        braceletId: addBraceletId,
      });
      setAddUserDialog(false);
      setAddBraceletId("");
      refetchQueue();
      toast({ title: "Пользователь добавлен в очередь" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedTable) return;
    try {
      await apiRequest("PATCH", `/api/tables/${selectedTable}`, {
        maxParallelGames,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", activeEventId, "tables"] });
      setSettingsDialog(false);
      toast({ title: "Настройки сохранены" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  if (!user) return null;
  if (!user.role.match(/admin|manager/)) {
    navigate("/");
    return null;
  }

  const currentTable = tables.find((t) => t.id === selectedTable);
  const playingEntries = queueEntries.filter((e) => e.status === "playing");
  const confirmedEntries = queueEntries.filter((e) => e.status === "confirmed");
  const waitingEntries = queueEntries.filter((e) => e.status === "waiting" || e.status === "notified");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">
              {isAdmin ? "Админ-панель" : "Менеджер"}
            </span>
            {activeEvent && (
              <Badge variant="outline" className="text-xs ml-1">
                {activeEvent.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="button-admin-panel">
                Аналитика
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout-manager">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {!activeEventId ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p>Нет активного события. Попросите администратора активировать событие.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Tables list */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Столы</h3>
              {tables.map((t) => {
                const tPlayingCount = t.queue?.filter((e: any) => e.status === "playing").length || 0;
                return (
                  <Card
                    key={t.id}
                    className={`cursor-pointer transition-colors ${selectedTable === t.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedTable(t.id)}
                    data-testid={`card-table-${t.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{t.gameName}</p>
                          <p className="text-xs text-muted-foreground">{t.tableName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={t.status === "free" ? "default" : "secondary"} className="text-xs">
                            {t.status === "free" ? "Свободен" : t.status === "playing" ? `Играют (${tPlayingCount}/${t.maxParallelGames})` : "Пауза"}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            <Users className="w-3 h-3 mr-1" />
                            {t.queueLength}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {tables.length === 0 && (
                <p className="text-sm text-muted-foreground p-4">Столы не созданы</p>
              )}
            </div>

            {/* Queue management */}
            <div className="md:col-span-2">
              {!selectedTable ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">Выберите стол для управления очередью</CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {/* Table header with controls */}
                  <Card>
                    <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-medium text-sm">{currentTable?.gameName}</p>
                        <p className="text-xs text-muted-foreground">
                          {currentTable?.tableName} · макс. партий: {currentTable?.maxParallelGames || 1}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {(() => {
                          const maxSlots = currentTable?.maxParallelGames || 1;
                          const playingCount = playingEntries.length;
                          const hasConfirmed = confirmedEntries.length > 0;
                          const canStartAnother = playingCount < maxSlots && hasConfirmed;
                          return (
                            <>
                              {(currentTable?.status === "free" || currentTable?.status === "paused" || canStartAnother) && hasConfirmed && (
                                <Button
                                  size="sm"
                                  onClick={() => handleStartSession(selectedTable)}
                                  data-testid="button-start-session"
                                >
                                  <Play className="w-3.5 h-3.5 mr-1" />
                                  {playingCount > 0 ? "Ещё партию" : "Начать партию"}
                                </Button>
                              )}
                              {playingEntries.length > 1 && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleEndAllSessions(selectedTable)}
                                  data-testid="button-end-all-sessions"
                                >
                                  <Square className="w-3.5 h-3.5 mr-1" /> Завершить все
                                </Button>
                              )}
                            </>
                          );
                        })()}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddUserDialog(true)}
                          data-testid="button-add-user"
                        >
                          <UserPlus className="w-3.5 h-3.5 mr-1" /> Добавить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setMaxParallelGames(currentTable?.maxParallelGames || 1);
                            setSettingsDialog(true);
                          }}
                          data-testid="button-table-settings"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Playing entries */}
                  {playingEntries.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Играют ({playingEntries.length}/{currentTable?.maxParallelGames || 1})
                      </h3>
                      <div className="space-y-1.5">
                        {playingEntries.map((entry) => (
                          <Card key={entry.id} className="border-blue-200 dark:border-blue-800">
                            <CardContent className="p-3 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3">
                                <div>
                                  <p className="text-sm font-medium">{entry.userName || "—"}</p>
                                  <p className="text-xs text-muted-foreground">#{entry.braceletId}</p>
                                </div>
                                <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                                  Играет
                                </Badge>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleEndOneSession(entry.id)}
                                data-testid={`button-end-session-${entry.id}`}
                              >
                                <Square className="w-3.5 h-3.5 mr-1" /> Завершить
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Confirmed entries */}
                  {confirmedEntries.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Подтвердили ({confirmedEntries.length})
                      </h3>
                      <div className="space-y-1.5">
                        {confirmedEntries.map((entry) => (
                          <Card key={entry.id} className="border-green-200 dark:border-green-800">
                            <CardContent className="p-3 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3">
                                <div>
                                  <p className="text-sm font-medium">{entry.userName || "—"}</p>
                                  <p className="text-xs text-muted-foreground">#{entry.braceletId}</p>
                                </div>
                                <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                                  Подтвердил
                                </Badge>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => handleSkip(entry.id)}
                                data-testid={`button-skip-${entry.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5 mr-1" /> Пропустить
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Queue (waiting + notified) */}
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Очередь ({waitingEntries.length})
                  </h3>
                  {waitingEntries.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Очередь пуста</CardContent></Card>
                  ) : (
                    <div className="space-y-1.5">
                      {waitingEntries.map((entry, index) => (
                        <Card key={entry.id}>
                          <CardContent className="p-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-muted-foreground w-5 text-right">
                                {index + 1}
                              </span>
                              <div>
                                <p className="text-sm font-medium">{entry.userName || "—"}</p>
                                <p className="text-xs text-muted-foreground">#{entry.braceletId}</p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {entry.status === "waiting" ? "Ждет" :
                                 entry.status === "notified" ? "Уведомлен" : entry.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === 0}
                                onClick={() => handleMoveUp(queueEntries.indexOf(entry))}
                                data-testid={`button-move-up-${entry.id}`}
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === waitingEntries.length - 1}
                                onClick={() => handleMoveDown(queueEntries.indexOf(entry))}
                                data-testid={`button-move-down-${entry.id}`}
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleSkip(entry.id)}
                                data-testid={`button-skip-${entry.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Add user dialog */}
      <Dialog open={addUserDialog} onOpenChange={setAddUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить в очередь</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Введите номер браслета. Если игрок ещё не зарегистрирован, он будет создан автоматически.
          </p>
          <Input
            data-testid="input-force-bracelet"
            type="text"
            inputMode="numeric"
            placeholder="Номер браслета"
            value={addBraceletId}
            onChange={(e) => setAddBraceletId(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleForceAdd()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddUserDialog(false)}>Отмена</Button>
            <Button onClick={handleForceAdd} disabled={!addBraceletId}>Добавить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table settings dialog */}
      <Dialog open={settingsDialog} onOpenChange={setSettingsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Настройки стола</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Параллельных партий</label>
              <p className="text-xs text-muted-foreground mb-2">Сколько игр может идти одновременно за этим столом</p>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setMaxParallelGames(Math.max(1, maxParallelGames - 1))}
                  disabled={maxParallelGames <= 1}
                >-</Button>
                <span className="text-lg font-semibold w-8 text-center">{maxParallelGames}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setMaxParallelGames(Math.min(10, maxParallelGames + 1))}
                  disabled={maxParallelGames >= 10}
                >+</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsDialog(false)}>Отмена</Button>
            <Button onClick={handleSaveSettings}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PerplexityAttribution />
    </div>
  );
}
