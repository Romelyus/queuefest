import { useAuth } from "@/contexts/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { QueueEntry, GameTable } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LogOut,
  ListOrdered,
  CheckCircle2,
  XCircle,
  Timer,
  Bell,
  Dice5,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

type QueueEntryWithTable = QueueEntry & { table?: GameTable };

const statusLabels: Record<string, string> = {
  waiting: "В очереди",
  notified: "Ваша очередь!",
  confirmed: "Подтверждено",
  playing: "Играете",
};

const statusColors: Record<string, string> = {
  waiting: "bg-muted text-muted-foreground",
  notified: "bg-primary text-primary-foreground",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  playing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
};

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { lastMessage, isConnected, on } = useWebSocket(user?.id);
  const [confirmDialogEntry, setConfirmDialogEntry] = useState<string | null>(null);
  const [confirmDeadline, setConfirmDeadline] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [justHandled, setJustHandled] = useState(false);

  const { data: queues = [], isLoading } = useQuery<QueueEntryWithTable[]>({
    queryKey: ["/api/users", user?.id, "queues"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/users/${user!.id}/queues`);
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 10000,
  });

  // Listen for WebSocket messages
  useEffect(() => {
    if (!user) return;

    const unsub1 = on("your_turn", (msg) => {
      const { entryId, deadline } = msg.payload as { entryId: string; deadline: string };
      setConfirmDialogEntry(entryId);
      setConfirmDeadline(deadline);
      queryClient.invalidateQueries({ queryKey: ["/api/users", user.id, "queues"] });
      // Try browser notification
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("QueueFest: Ваша очередь!", {
          body: "Подтвердите участие в течение 3 минут",
          icon: "/dice-icon.png",
        });
      }
      toast({
        title: "Ваша очередь!",
        description: "Подтвердите участие в течение 3 минут",
      });
    });

    const unsub2 = on("queue_updated", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", user.id, "queues"] });
    });

    const unsub3 = on("removed_from_queue", (msg) => {
      const reason = (msg.payload as any).reason;
      queryClient.invalidateQueries({ queryKey: ["/api/users", user.id, "queues"] });
      toast({
        title: reason === "skipped" ? "Вас пропустили" : "Удалены из очереди",
        description: reason === "skipped"
          ? "Менеджер пропустил вашу очередь"
          : "Вы были удалены из очереди",
        variant: "destructive",
      });
    });

    const unsub4 = on("confirm_timeout", () => {
      setConfirmDialogEntry(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users", user.id, "queues"] });
      toast({
        title: "Время вышло",
        description: "Вы не подтвердили участие вовремя",
        variant: "destructive",
      });
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [user, on, queryClient, toast]);

  // Countdown timer for confirmation
  useEffect(() => {
    if (!confirmDeadline) {
      setCountdown(null);
      return;
    }
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(confirmDeadline).getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        setConfirmDialogEntry(null);
        setConfirmDeadline(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [confirmDeadline]);

  const handleConfirm = async (entryId: string) => {
    try {
      await apiRequest("POST", `/api/queue/${entryId}/confirm`);
      setJustHandled(true);
      setConfirmDialogEntry(null);
      setConfirmDeadline(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users", user!.id, "queues"] });
      toast({ title: "Подтверждено", description: "Идите к столу!" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleCancel = async (entryId: string) => {
    try {
      await apiRequest("POST", `/api/queue/${entryId}/cancel`);
      setJustHandled(true);
      setConfirmDialogEntry(null);
      setConfirmDeadline(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users", user!.id, "queues"] });
      toast({ title: "Отменено", description: "Вы вышли из очереди" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  if (!user) return null;

  // Check for notified entries on initial load
  const notifiedEntry = queues.find((q) => q.status === "notified");
  useEffect(() => {
    if (notifiedEntry && !confirmDialogEntry && !justHandled) {
      setConfirmDialogEntry(notifiedEntry.id);
      if (notifiedEntry.confirmDeadline) {
        setConfirmDeadline(notifiedEntry.confirmDeadline);
      }
    }
    if (!notifiedEntry && justHandled) {
      setJustHandled(false);
    }
  }, [notifiedEntry, confirmDialogEntry, justHandled]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Dice5 className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">QueueFest</span>
            {isConnected ? (
              <Wifi className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              #{user.braceletId}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4 pb-20">
        <div>
          <h2 className="text-lg font-semibold">Мои очереди</h2>
          <p className="text-sm text-muted-foreground">Управляйте записями и следите за статусом</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : queues.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <ListOrdered className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Нет активных очередей</p>
              <p className="text-xs text-muted-foreground">
                Отсканируйте QR-код на столе, чтобы записаться на игру
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {queues.map((q) => (
              <Card key={q.id} className={q.status === "notified" ? "ring-2 ring-primary" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm truncate">
                          {q.table?.gameName || "Игра"}
                        </span>
                        <Badge variant="secondary" className={`text-xs shrink-0 ${statusColors[q.status] || ""}`}>
                          {statusLabels[q.status] || q.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Стол: {q.table?.tableName || "—"}
                      </p>
                      {q.status === "waiting" && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                          <Users className="w-3.5 h-3.5" />
                          <span>Позиция: {q.position}</span>
                        </div>
                      )}
                      {q.status === "notified" && (
                        <div className="flex items-center gap-1 mt-1.5">
                          <Bell className="w-3.5 h-3.5 text-primary animate-bounce" />
                          <span className="text-xs text-primary font-medium">
                            Подтвердите участие!
                          </span>
                        </div>
                      )}
                      {q.status === "confirmed" && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-green-700 dark:text-green-300">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Идите к столу</span>
                        </div>
                      )}
                      {q.status === "playing" && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-blue-700 dark:text-blue-300">
                          <Timer className="w-3.5 h-3.5" />
                          <span>Партия идет</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {q.status === "notified" && (
                        <Button
                          size="sm"
                          onClick={() => handleConfirm(q.id)}
                          data-testid={`button-confirm-${q.id}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Иду!
                        </Button>
                      )}
                      {(q.status === "waiting" || q.status === "notified") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleCancel(q.id)}
                          data-testid={`button-cancel-${q.id}`}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          Выйти
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Request notifications permission */}
        {"Notification" in window && Notification.permission === "default" && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => Notification.requestPermission()}
            data-testid="button-enable-notifications"
          >
            <Bell className="w-4 h-4 mr-2" />
            Включить уведомления
          </Button>
        )}
      </main>

      {/* Confirmation dialog */}
      <AlertDialog
        open={!!confirmDialogEntry}
        onOpenChange={(open) => !open && setConfirmDialogEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Ваша очередь!
            </AlertDialogTitle>
            <AlertDialogDescription>
              Стол свободен. Подтвердите, что идете играть.
              {countdown !== null && (
                <span className="block mt-2 text-primary font-semibold text-base">
                  Осталось: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => confirmDialogEntry && handleCancel(confirmDialogEntry)}
            >
              Пропустить
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDialogEntry && handleConfirm(confirmDialogEntry)}
            >
              Иду играть!
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PerplexityAttribution />
    </div>
  );
}
