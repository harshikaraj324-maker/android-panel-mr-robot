import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-5xl font-bold text-muted-foreground/30">404</p>
      <p className="text-sm text-muted-foreground">Page not found</p>
      <Link href="/">
        <Button size="sm" variant="outline" data-testid="link-go-home">
          <Home className="w-3.5 h-3.5 mr-2" />
          Go Home
        </Button>
      </Link>
    </div>
  );
}
