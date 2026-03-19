import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { GameTable, QueueEntry, Event } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Clock,
  Shield,
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
  const { on } = useWebSocket(user?.id);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [addUserDialog, setAddUserDialog] = useState(false);
  const [addBraceletId, setAddBraceletId] = useState("");

  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  const { data: tables = [] } = useQuery<TableWithQueue[]>({
    queryKey: ["/api/events", selectedEvent, "tables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${selectedEvent}/tables`);
      return res.json();
    },
    enabled: !!selectedEvent,
    refetchInterval: 5000,
  });

  const { data: queueEntries = [], refetch: refetchQueue } = useQuery<QueueEntryEnriched[]>({
    queryKey: ["/api/tables", selectedTable, "queue"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tables/${selectedTable}/queue`);
      return res.json();
    },
    enabled: !!selectedTable,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (events.length > 0 && !selectedEvent) {
      const active = events.find((e) => e.isActive);
      if (active) setSelectedEvent(active.id);
    }
  }, [events, selectedEvent]);

  useEffect(() => {
    const unsub = on("queue_updated", () => {
      if (selectedTable) refetchQueue();
      queryClient.invalidateQueries({ queryKey: ["/api/events", selectedEvent, "tables"] });
    });
    return unsub;
  }, [on, selectedTable, selectedEvent, refetchQueue, queryClient]);

  const handleStartSession = async (tableId: string) => {
    try {
      await apiRequest("POST", `/api/tables/${tableId}/start-session`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", selectedEvent, "tables"] });
      refetchQueue();
      toast({ title: "Партия начата" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleEndSession = async (tableId: string) => {
    try {
      await apiRequest("POST", `/api/tables/${tableId}/end-session`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", selectedEvent, "tables"] });
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
    if (!addBraceletId || !selectedTable || !selectedEvent) return;
    try {
      await apiRequest("POST", "/api/queue/force-add", {
        tableId: selectedTable,
        braceletId: addBraceletId,
        eventId: selectedEvent,
      });
      setAddUserDialog(false);
      setAddBraceletId("");
      refetchQueue();
      toast({ title: "Пользователь добавлен в очередь" });
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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">
              {isAdmin ? "Админ-панель" : "Менеджер"}
            </span>
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
        {/* Event selector */}
        <div className="flex gap-3 flex-wrap">
          <Select value={selectedEvent} onValueChange={(v) => { setSelectedEvent(v); setSelectedTable(null); }}>
            <SelectTrigger className="w-64" data-testid="select-manager-event">
              <SelectValue placeholder="Выберите событие" />
            </SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedEvent ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Выберите событие</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Tables list */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Столы</h3>
              {tables.map((t) => (
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
                          {t.status === "free" ? "Свободен" : t.status === "playing" ? "Играют" : "Пауза"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          <Users className="w-3 h-3 mr-1" />
                          {t.queueLength}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
                  {/* Table controls */}
                  <Card>
                    <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-medium text-sm">{currentTable?.gameName}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {currentTable?.estimatedMinutes} мин
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {currentTable?.status === "free" || currentTable?.status === "paused" ? (
                          <Button
                            size="sm"
                            onClick={() => handleStartSession(selectedTable)}
                            data-testid="button-start-session"
                          >
                            <Play className="w-3.5 h-3.5 mr-1" /> Начать партию
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleEndSession(selectedTable)}
                            data-testid="button-end-session"
                          >
                            <Square className="w-3.5 h-3.5 mr-1" /> Завершить
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddUserDialog(true)}
                          data-testid="button-add-user"
                        >
                          <UserPlus className="w-3.5 h-3.5 mr-1" /> Добавить
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Queue list */}
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Очередь ({queueEntries.length})
                  </h3>
                  {queueEntries.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Очередь пуста</CardContent></Card>
                  ) : (
                    <div className="space-y-1.5">
                      {queueEntries.map((entry, index) => (
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
                                 entry.status === "notified" ? "Уведомлен" :
                                 entry.status === "confirmed" ? "Подтвердил" :
                                 entry.status === "playing" ? "Играет" : entry.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === 0}
                                onClick={() => handleMoveUp(index)}
                                data-testid={`button-move-up-${entry.id}`}
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={index === queueEntries.length - 1}
                                onClick={() => handleMoveDown(index)}
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

      <PerplexityAttribution />
    </div>
  );
}
