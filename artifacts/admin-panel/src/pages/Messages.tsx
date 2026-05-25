import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MessageRow, AppIdRow } from "@/lib/api";
import { MessageSquare, Trash2, RefreshCw, Search, Send, CheckCheck, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Messages() {
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [showSend, setShowSend] = useState(false);
  const [sendAppId, setSendAppId] = useState("");
  const [sendSubId, setSendSubId] = useState("");
  const [sendContent, setSendContent] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: messages = [], isLoading, refetch } = useQuery({
    queryKey: ["messages"],
    queryFn: () => api.listMessages(),
  });
  const { data: appData } = useQuery({ queryKey: ["app-ids"], queryFn: api.listAppIds });
  const appIds: AppIdRow[] = appData?.rows ?? [];

  const readMut = useMutation({
    mutationFn: (id: number) => api.markRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["messages"] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteMessage(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["messages"] }); qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const sendMut = useMutation({
    mutationFn: () => api.sendMessage({ app_id: sendAppId, sub_id: sendSubId || undefined, content: sendContent, message_type: "admin" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      toast({ title: "Message bhej diya! ✅" });
      setShowSend(false); setSendContent(""); setSendSubId("");
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const allAppIds = Array.from(new Set((messages as MessageRow[]).map((m) => m.app_id)));
  const unread = (messages as MessageRow[]).filter((m) => !m.is_read).length;

  const filtered = (messages as MessageRow[]).filter((m) => {
    const matchApp = appFilter === "all" || m.app_id === appFilter;
    const q = search.toLowerCase();
    return matchApp && (!q || m.app_id.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || (m.sub_id ?? "").toLowerCase().includes(q));
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Messages
            {unread > 0 && <span className="text-xs bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-medium">{unread}</span>}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{unread} unread · {messages.length} total</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" onClick={() => setShowSend(true)}><Send className="w-4 h-4 mr-1.5" /> Send Message</Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search messages..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-full sm:w-44 h-8 text-sm"><SelectValue placeholder="Filter by App" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Apps</SelectItem>
            {allAppIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16">
              <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{messages.length === 0 ? "Koi message nahi hai abhi." : "Koi match nahi mila."}</p>
              <Button size="sm" className="mt-4" onClick={() => setShowSend(true)}><Send className="w-3.5 h-3.5 mr-1.5" /> Pehla Message Bhejo</Button>
            </CardContent>
          </Card>
        ) : (
          filtered.map((m) => (
            <Card key={m.id} className={cn("transition-all", !m.is_read && "border-primary/30 bg-primary/3")}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {!m.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                      <span className="font-mono text-xs font-bold text-primary">{m.app_id}</span>
                      {m.sub_id && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">sub: {m.sub_id}</span>}
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground capitalize">{m.message_type}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{fmt(m.sent_at)}</span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{m.content}</p>
                    {m.from_id && <p className="text-[10px] text-muted-foreground mt-1">From: {m.from_id}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!m.is_read && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-green-500" title="Mark Read"
                        onClick={() => readMut.mutate(m.id)}>
                        <CheckCheck className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMut.mutate(m.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Send Message Dialog */}
      <Dialog open={showSend} onOpenChange={(o) => !o && setShowSend(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Message Bhejo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">App ID <span className="text-red-500">*</span></label>
              <Select value={sendAppId} onValueChange={setSendAppId}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="App ID select karo" /></SelectTrigger>
                <SelectContent>
                  {appIds.map((a) => <SelectItem key={a.app_id} value={a.app_id}>{a.app_id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Sub ID <span className="text-muted-foreground font-normal text-xs">(optional)</span></label>
              <Input placeholder="Specific user Sub ID" value={sendSubId} onChange={(e) => setSendSubId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message <span className="text-red-500">*</span></label>
              <Textarea placeholder="Message likhो..." value={sendContent} onChange={(e) => setSendContent(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSend(false)}>Cancel</Button>
            <Button onClick={() => sendMut.mutate()} disabled={!sendAppId || !sendContent || sendMut.isPending}>
              {sendMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Sending...</> : <><Send className="w-4 h-4 mr-1.5" /> Send</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
