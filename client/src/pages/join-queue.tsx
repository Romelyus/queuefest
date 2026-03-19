import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GameTable, QueueEntry } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Event } from "@shared/schema";
import { Clock, Users, ListOrdered, CheckCircle2, ArrowLeft, Dice5 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TableWithQueue = GameTable & { queueLength: number; queue: QueueEntry[] };

export default function JoinQueuePage() {
  const params = useParams<{ tableId: string }>();
  const { user, login, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [braceletId, setBraceletId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState("");
  const [joining, setJoining] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["/api/events/active"],
  });

  const { data: table, isLoading } = useQuery<TableWithQueue>({
    queryKey: ["/api/tables", params.tableId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tables/${params.tableId}`);
      return res.json();
    },
    enabled: !!params.tableId,
    refetchInterval: 5000,
  });

  // If only one event, auto-select it
  useEffect(() => {
    if (events.length === 1 && !selectedEvent) {
      setSelectedEvent(events[0].id);
    }
  }, [events, selectedEvent]);

  const handleLogin = async () => {
    if (!braceletId || !selectedEvent) {
      toast({ title: "Ошибка", description: "Введите номер браслета", variant: "destructive" });
      return;
    }
    setLoginLoading(true);
    try {
      await login(braceletId, selectedEvent);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !table) return;
    setJoining(true);
    try {
      await apiRequest("POST", "/api/queue/join", {
        tableId: table.id,
        userId: user.id,
      });
      toast({ title: "Записаны!", description: `Вы в очереди на «${table.gameName}»` });
      queryClient.invalidateQueries({ queryKey: ["/api/tables", params.tableId] });
      // Small delay then navigate
      setTimeout(() => navigate("/dashboard"), 1000);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setJoining(false);
    }
  };

  const alreadyInQueue = table?.queue?.some(
    (e) => e.userId === user?.id && ["waiting", "notified", "confirmed", "playing"].includes(e.status)
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center px-4 h-14 gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(isAuthenticated ? "/dashboard" : "/")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Dice5 className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">Записаться в очередь</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-5 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-1/3" />
              </div>
            </CardContent>
          </Card>
        ) : !table ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Стол не найден</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Table info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{table.gameName}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <ListOrdered className="w-4 h-4" />
                    <span>Стол: {table.tableName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    <span>{table.minPlayers}-{table.maxPlayers} игроков</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>~{table.estimatedMinutes} мин</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={table.status === "free" ? "default" : "secondary"}>
                    {table.status === "free" ? "Свободен" : table.status === "playing" ? "Идет партия" : "Пауза"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    В очереди: {table.queueLength}
                  </span>
                </div>

                {table.queueLength > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Примерное ожидание: ~{table.queueLength * table.estimatedMinutes} мин
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Login or Join */}
            {!isAuthenticated ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Авторизуйтесь</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {events.length > 1 && (
                    <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                      <SelectTrigger>
                        <SelectValue placeholder="Фестиваль" />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    data-testid="input-bracelet-join"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Номер с браслета"
                    value={braceletId}
                    onChange={(e) => setBraceletId(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="text-center text-lg tracking-widest"
                  />
                  <Button
                    className="w-full"
                    onClick={handleLogin}
                    disabled={loginLoading || !braceletId}
                    data-testid="button-login-join"
                  >
                    {loginLoading ? "Вход..." : "Войти и записаться"}
                  </Button>
                </CardContent>
              </Card>
            ) : alreadyInQueue ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium">Вы уже в очереди</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => navigate("/dashboard")}
                    data-testid="button-go-dashboard"
                  >
                    Мои очереди
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Button
                className="w-full h-12 text-base"
                onClick={handleJoin}
                disabled={joining}
                data-testid="button-join-queue"
              >
                {joining ? "Записываем..." : "Записаться в очередь"}
              </Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
