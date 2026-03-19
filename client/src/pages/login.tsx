import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";
import type { Event } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dice5, Shield, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const { login, adminLogin } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [braceletId, setBraceletId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [selectedEvent, setSelectedEvent] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["/api/events/active"],
  });

  const handleUserLogin = async () => {
    if (!braceletId || !selectedEvent) {
      toast({ title: "Ошибка", description: "Выберите событие и введите номер браслета", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await login(braceletId, selectedEvent);
      navigate("/dashboard");
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminPassword) {
      toast({ title: "Ошибка", description: "Введите пароль", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const user = await adminLogin(adminPassword, selectedEvent || undefined);
      if (user.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/manager");
      }
    } catch (e: any) {
      toast({ title: "Ошибка входа", description: "Неверный пароль", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Dice5 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-app-title">QueueFest</h1>
          <p className="text-sm text-muted-foreground">Система очередей фестиваля настольных игр</p>
        </div>

        <Tabs defaultValue="user" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="user" data-testid="tab-user">
              <Users className="w-4 h-4 mr-1.5" /> Посетитель
            </TabsTrigger>
            <TabsTrigger value="staff" data-testid="tab-staff">
              <Shield className="w-4 h-4 mr-1.5" /> Персонал
            </TabsTrigger>
          </TabsList>

          <TabsContent value="user">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Вход по браслету</CardTitle>
                <CardDescription>Введите номер с вашего браслета</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {events.length > 0 && (
                  <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                    <SelectTrigger data-testid="select-event">
                      <SelectValue placeholder="Выберите фестиваль" />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  data-testid="input-bracelet"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Номер браслета"
                  value={braceletId}
                  onChange={(e) => setBraceletId(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleUserLogin()}
                  className="text-center text-lg tracking-widest"
                />
                <Button
                  data-testid="button-login"
                  className="w-full"
                  onClick={handleUserLogin}
                  disabled={loading || !braceletId}
                >
                  {loading ? "Вход..." : "Войти"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="staff">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Вход для персонала</CardTitle>
                <CardDescription>Администратор или менеджер</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {events.length > 0 && (
                  <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                    <SelectTrigger data-testid="select-event-admin">
                      <SelectValue placeholder="Выберите фестиваль (опционально)" />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  data-testid="input-admin-password"
                  type="password"
                  placeholder="Пароль"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                />
                <Button
                  data-testid="button-admin-login"
                  className="w-full"
                  onClick={handleAdminLogin}
                  disabled={loading || !adminPassword}
                >
                  {loading ? "Вход..." : "Войти"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
