import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import type { Express } from "express";

// Setup local authentication strategy
export function setupLocalAuth(app: Express) {
  // Local Strategy
  passport.use(
    'local',
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          // Find user by email with local auth type
          const users = await storage.getUserByEmailAndType(email, 'local');
          const user = users[0];

          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          // Check password
          const isValidPassword = await bcrypt.compare(password, user.password!);
          if (!isValidPassword) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // Local login route
  app.post('/api/auth/local/login', (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: 'Authentication error', error: err.message });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || 'Authentication failed' });
      }

      req.logIn(user, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Login error', error: err.message });
        }
        res.json({
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          authType: user.authType
        });
      });
    })(req, res, next);
  });

  // Create local user route (for admin setup)
  app.post('/api/auth/local/create', async (req, res) => {
    try {
      const { email, password, role = 'employee' } = req.body;

      // Check if user already exists
      const existingUsers = await storage.getUserByEmailAndType(email, 'local');
      if (existingUsers.length > 0) {
        return res.status(400).json({ message: 'User already exists with local authentication' });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const userData = {
        id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email,
        password: hashedPassword,
        authType: 'local' as const,
        role,
        firstName: email.split('@')[0], // Default first name from email
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const user = await storage.upsertUser(userData);
      res.status(201).json({
        id: user.id,
        email: user.email,
        role: user.role,
        authType: user.authType,
        message: 'Local user created successfully'
      });
    } catch (error) {
      console.error('Error creating local user:', error);
      res.status(500).json({ message: 'Failed to create user', error });
    }
  });

  // Check authentication for local users
  app.get('/api/auth/local/check', (req: any, res) => {
    if (req.isAuthenticated() && req.user.authType === 'local') {
      res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          authType: req.user.authType
        }
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  // Logout route
  app.post('/api/auth/local/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: 'Logout error', error: err.message });
      }
      res.json({ message: 'Logged out successfully' });
    });
  });
}

// Middleware to check if user is authenticated (works for both local and Replit auth)
export function isAuthenticatedLocal(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized' });
}