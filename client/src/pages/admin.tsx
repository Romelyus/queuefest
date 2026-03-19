import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { Event, QueueAnalytics, InsertEvent, InsertTable } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart3,
  Plus,
  Trash2,
  LogOut,
  Shield,
  Calendar,
  Users,
  ListOrdered,
  Clock,
  QrCode,
  Download,
  Dice5,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [createEventDialog, setCreateEventDialog] = useState(false);
  const [createTableDialog, setCreateTableDialog] = useState(false);
  const [eventForm, setEventForm] = useState<InsertEvent>({ name: "", description: "", date: "" });
  const [tableForm, setTableForm] = useState<InsertTable>({
    eventId: "", tableName: "", gameName: "", minPlayers: 2, maxPlayers: 6, estimatedMinutes: 30,
  });

  const { data: events = [] } = useQuery<Event[]>({ queryKey: ["/api/events"] });

  const { data: tables = [] } = useQuery<any[]>({
    queryKey: ["/api/events", selectedEvent, "tables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${selectedEvent}/tables`);
      return res.json();
    },
    enabled: !!selectedEvent,
  });

  const { data: analytics = [] } = useQuery<QueueAnalytics[]>({
    queryKey: ["/api/events", selectedEvent, "analytics"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${selectedEvent}/analytics`);
      return res.json();
    },
    enabled: !!selectedEvent,
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery<{
    totalVisitors: number;
    totalQueueEntries: number;
    activeQueues: number;
    avgWaitTime: number;
  }>({
    queryKey: ["/api/events", selectedEvent, "stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${selectedEvent}/stats`);
      return res.json();
    },
    enabled: !!selectedEvent,
    refetchInterval: 10000,
  });

  const handleCreateEvent = async () => {
    try {
      const res = await apiRequest("POST", "/api/events", eventForm);
      const ev = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setCreateEventDialog(false);
      setEventForm({ name: "", description: "", date: "" });
      setSelectedEvent(ev.id);
      toast({ title: "Событие создано" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteEvent = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/events/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      if (selectedEvent === id) setSelectedEvent("");
      toast({ title: "Событие удалено" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateTable = async () => {
    try {
      await apiRequest("POST", "/api/tables", { ...tableForm, eventId: selectedEvent });
      queryClient.invalidateQueries({ queryKey: ["/api/events", selectedEvent, "tables"] });
      setCreateTableDialog(false);
      setTableForm({ eventId: "", tableName: "", gameName: "", minPlayers: 2, maxPlayers: 6, estimatedMinutes: 30 });
      toast({ title: "Стол создан" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteTable = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/tables/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/events", selectedEvent, "tables"] });
      toast({ title: "Стол удален" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleDownloadQR = async () => {
    try {
      const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, "");
      const res = await apiRequest("GET", `/api/events/${selectedEvent}/qr-codes?baseUrl=${encodeURIComponent(baseUrl)}`);
      const codes = await res.json();
      // Create printable HTML
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR-коды столов</title>
<style>body{font-family:sans-serif;margin:0;padding:20px}
.qr-card{display:inline-block;width:250px;margin:15px;padding:20px;border:2px solid #ddd;border-radius:12px;text-align:center;page-break-inside:avoid}
.qr-card img{width:200px;height:200px}
.qr-card h3{margin:10px 0 4px;font-size:16px}
.qr-card p{margin:0;color:#666;font-size:13px}
@media print{.qr-card{border:1px solid #ccc}}</style></head>
<body><h1>QR-коды столов</h1><div>${codes.map((c: any) => `
<div class="qr-card">
<img src="${c.qrDataUrl}" alt="QR ${c.tableName}"/>
<h3>${c.gameName}</h3>
<p>${c.tableName}</p>
</div>`).join("")}</div></body></html>`;
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qr-codes.html";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "QR-коды скачаны" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleLogout = () => { logout(); navigate("/"); };

  if (!user) return null;
  if (user.role !== "admin") { navigate("/"); return null; }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">Админ-панель</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/manager")} data-testid="button-manager-panel">
              Очереди
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout-admin">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events"><Calendar className="w-3.5 h-3.5 mr-1.5" />События</TabsTrigger>
            <TabsTrigger value="tables" disabled={!selectedEvent}><Dice5 className="w-3.5 h-3.5 mr-1.5" />Столы</TabsTrigger>
            <TabsTrigger value="analytics" disabled={!selectedEvent}><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Аналитика</TabsTrigger>
          </TabsList>

          {/* Events tab */}
          <TabsContent value="events" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">События</h2>
              <Button size="sm" onClick={() => setCreateEventDialog(true)} data-testid="button-create-event">
                <Plus className="w-3.5 h-3.5 mr-1" /> Создать событие
              </Button>
            </div>
            {events.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Нет событий. Создайте первое.</CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((ev) => (
                  <Card
                    key={ev.id}
                    className={`cursor-pointer ${selectedEvent === ev.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedEvent(ev.id)}
                    data-testid={`card-event-${ev.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{ev.name}</CardTitle>
                        <Badge variant={ev.isActive ? "default" : "secondary"} className="text-xs">
                          {ev.isActive ? "Активно" : "Завершено"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <p className="text-xs text-muted-foreground">{ev.date}</p>
                      {ev.description && <p className="text-xs text-muted-foreground mt-1">{ev.description}</p>}
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDeleteEvent(ev.id); }}
                          data-testid={`button-delete-event-${ev.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Tables tab */}
          <TabsContent value="tables" className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">Столы</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDownloadQR} disabled={tables.length === 0} data-testid="button-download-qr">
                  <QrCode className="w-3.5 h-3.5 mr-1" /> Скачать QR
                </Button>
                <Button size="sm" onClick={() => setCreateTableDialog(true)} data-testid="button-create-table">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Добавить стол
                </Button>
              </div>
            </div>
            {tables.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Нет столов. Добавьте первый.</CardContent></Card>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Стол</TableHead>
                      <TableHead>Игра</TableHead>
                      <TableHead>Игроки</TableHead>
                      <TableHead>Время</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Очередь</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tables.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium text-sm">{t.tableName}</TableCell>
                        <TableCell className="text-sm">{t.gameName}</TableCell>
                        <TableCell className="text-sm">{t.minPlayers}-{t.maxPlayers}</TableCell>
                        <TableCell className="text-sm">{t.estimatedMinutes} мин</TableCell>
                        <TableCell>
                          <Badge variant={t.status === "free" ? "default" : "secondary"} className="text-xs">
                            {t.status === "free" ? "Свободен" : t.status === "playing" ? "Играют" : "Пауза"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{t.queueLength}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDeleteTable(t.id)}
                            data-testid={`button-delete-table-${t.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Analytics tab */}
          <TabsContent value="analytics" className="space-y-4">
            <h2 className="text-lg font-semibold">Аналитика</h2>

            {stats && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Users className="w-4 h-4" /><span className="text-xs">Посетители</span>
                    </div>
                    <p className="text-xl font-bold">{stats.totalVisitors}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <ListOrdered className="w-4 h-4" /><span className="text-xs">Всего записей</span>
                    </div>
                    <p className="text-xl font-bold">{stats.totalQueueEntries}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Users className="w-4 h-4" /><span className="text-xs">В очередях</span>
                    </div>
                    <p className="text-xl font-bold">{stats.activeQueues}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock className="w-4 h-4" /><span className="text-xs">Среднее ожидание</span>
                    </div>
                    <p className="text-xl font-bold">{stats.avgWaitTime} мин</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {analytics.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Стол</TableHead>
                      <TableHead>Игра</TableHead>
                      <TableHead>Всего</TableHead>
                      <TableHead>Сыграно</TableHead>
                      <TableHead>Отказы</TableHead>
                      <TableHead>Истекло</TableHead>
                      <TableHead>Пропущено</TableHead>
                      <TableHead>Ожидание</TableHead>
                      <TableHead>Партия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.map((a) => (
                      <TableRow key={a.tableId}>
                        <TableCell className="font-medium text-sm">{a.tableName}</TableCell>
                        <TableCell className="text-sm">{a.gameName}</TableCell>
                        <TableCell className="text-sm">{a.totalEntries}</TableCell>
                        <TableCell className="text-sm">{a.completedEntries}</TableCell>
                        <TableCell className="text-sm">{a.cancelledEntries}</TableCell>
                        <TableCell className="text-sm">{a.expiredEntries}</TableCell>
                        <TableCell className="text-sm">{a.skippedEntries}</TableCell>
                        <TableCell className="text-sm">{a.avgWaitMinutes} мин</TableCell>
                        <TableCell className="text-sm">{a.avgSessionMinutes} мин</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Create event dialog */}
      <Dialog open={createEventDialog} onOpenChange={setCreateEventDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Создать событие</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              data-testid="input-event-name"
              placeholder="Название фестиваля"
              value={eventForm.name}
              onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
            />
            <Input
              data-testid="input-event-date"
              type="date"
              value={eventForm.date}
              onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
            />
            <Input
              data-testid="input-event-desc"
              placeholder="Описание (необязательно)"
              value={eventForm.description}
              onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateEventDialog(false)}>Отмена</Button>
            <Button onClick={handleCreateEvent} disabled={!eventForm.name || !eventForm.date}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create table dialog */}
      <Dialog open={createTableDialog} onOpenChange={setCreateTableDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить стол</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              data-testid="input-table-name"
              placeholder="Название стола (напр. Стол 1)"
              value={tableForm.tableName}
              onChange={(e) => setTableForm({ ...tableForm, tableName: e.target.value })}
            />
            <Input
              data-testid="input-game-name"
              placeholder="Название игры"
              value={tableForm.gameName}
              onChange={(e) => setTableForm({ ...tableForm, gameName: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Мин. игроков</label>
                <Input
                  data-testid="input-min-players"
                  type="number"
                  min={1}
                  value={tableForm.minPlayers}
                  onChange={(e) => setTableForm({ ...tableForm, minPlayers: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Макс. игроков</label>
                <Input
                  data-testid="input-max-players"
                  type="number"
                  min={1}
                  value={tableForm.maxPlayers}
                  onChange={(e) => setTableForm({ ...tableForm, maxPlayers: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Время (мин)</label>
                <Input
                  data-testid="input-est-minutes"
                  type="number"
                  min={1}
                  value={tableForm.estimatedMinutes}
                  onChange={(e) => setTableForm({ ...tableForm, estimatedMinutes: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTableDialog(false)}>Отмена</Button>
            <Button onClick={handleCreateTable} disabled={!tableForm.tableName || !tableForm.gameName}>Добавить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PerplexityAttribution />
    </div>
  );
}
