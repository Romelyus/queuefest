import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTableRealtime } from "@/hooks/use-realtime";
import { apiRequest } from "@/lib/queryClient";
import type { GameTable, QueueEntry, Event } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ListOrdered, CheckCircle2, ArrowLeft, Dice5, AlertCircle, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TableWithQueue = GameTable & { queueLength: number; queue: QueueEntry[] };

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || "QueueFestBot";

export default function JoinQueuePage() {
  const params = useParams<{ tableId: string }>();
  const { user, login, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [braceletId, setBraceletId] = useState("");
  const [joining, setJoining] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [joined, setJoined] = useState(false);

  const { data: activeEvent } = useQuery<Event | null>({
    queryKey: ["/api/events/active"],
  });

  const { data: table, isLoading } = useQuery<TableWithQueue>({
    queryKey: ["/api/tables", params.tableId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tables/${params.tableId}`);
      return res.json();
    },
    enabled: !!params.tableId,
  });

  // Supabase Realtime for this table
  useTableRealtime(
    "queue_entries",
    [["/api/tables", params.tableId || ""]],
    !!params.tableId
  );

  const handleLogin = async () => {
    if (!braceletId) {
      toast({ title: "Ошибка", description: "Введите номер браслета", variant: "destructive" });
      return;
    }
    if (!activeEvent) {
      toast({ title: "Ошибка", description: "Нет активного события", variant: "destructive" });
      return;
    }
    setLoginLoading(true);
    try {
      await login(braceletId, activeEvent.id);
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
      setJoined(true);
      toast({ title: "Записаны!", description: `Вы в очереди на «${table.gameName}»` });
      queryClient.invalidateQueries({ queryKey: ["/api/tables", params.tableId] });
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
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={table.status === "free" ? "default" : "secondary"}>
                    {table.status === "free" ? "Свободен" : table.status === "playing" ? "Идет партия" : "Пауза"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    В очереди: {table.queueLength}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Login or Join */}
            {!isAuthenticated ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Авторизуйтесь</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!activeEvent && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Нет активного события</span>
                    </div>
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
                    disabled={loginLoading || !braceletId || !activeEvent}
                    data-testid="button-login-join"
                  >
                    {loginLoading ? "Вход..." : "Войти и записаться"}
                  </Button>
                </CardContent>
              </Card>
            ) : joined ? (
              /* Successfully joined — show Telegram deeplink (per-user) */
              <Card>
                <CardContent className="p-6 text-center space-y-4">
                  <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
                  <div>
                    <p className="text-sm font-medium">Вы записаны в очередь!</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Получите уведомление, когда подойдёт ваша очередь
                    </p>
                  </div>
                  <a
                    href={`https://t.me/${BOT_USERNAME}?start=user_${user!.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0088cc] text-white hover:bg-[#0077b5] transition-colors text-sm font-medium"
                    data-testid="link-telegram-notify"
                  >
                    <Send className="w-4 h-4" />
                    Уведомления в Telegram
                  </a>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate("/dashboard")}
                    data-testid="button-go-dashboard"
                  >
                    Мои очереди
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
