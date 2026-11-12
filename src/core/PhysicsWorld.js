import * as CANNON from 'cannon-es';

/**
 * PhysicsWorld — Cannon-es world, materials, contact tuning and collision events.
 */
export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -20, 0), // heavier-than-real gravity = planted arcade feel, short airtime
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.solver.iterations = 10;

    // ---- Materials ----
    this.materials = {
      ground: new CANNON.Material('ground'),
      car: new CANNON.Material('car'),
      prop: new CANNON.Material('prop'),
      wall: new CANNON.Material('wall'),
    };
    const M = this.materials;
    const cm = (a, b, friction, restitution) =>
      this.world.addContactMaterial(new CANNON.ContactMaterial(a, b, {
        friction, restitution,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
      }));
    cm(M.car, M.ground, 0.05, 0.05);  // chassis scraping road: slide, don't stick
    cm(M.car, M.wall, 0.02, 0.25);    // grind along guardrails
    cm(M.car, M.prop, 0.3, 0.4);
    cm(M.prop, M.ground, 0.6, 0.2);
    cm(M.prop, M.prop, 0.4, 0.3);
    cm(M.car, M.car, 0.1, 0.3);

    // Static ground slab (a Box — more robust than Plane for wheel raycasts).
    this.groundBody = new CANNON.Body({
      mass: 0,
      material: M.ground,
      shape: new CANNON.Box(new CANNON.Vec3(1200, 2, 1200)),
      position: new CANNON.Vec3(0, -2.05, 0),
    });
    this.groundBody.userData = { type: 'ground' };
    this.world.addBody(this.groundBody);

    this._collisionListeners = new Set();
    this._onBeginContact = this._onBeginContact.bind(this);
    this.world.addEventListener('beginContact', this._onBeginContact);
  }

  _onBeginContact(evt) {
    const { bodyA, bodyB } = evt;
    if (!bodyA || !bodyB) return;
    // Compute impact velocity along the contact normal.
    let impact = 0;
    const contacts = this.world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if ((c.bi === bodyA && c.bj === bodyB) || (c.bi === bodyB && c.bj === bodyA)) {
        const vA = new CANNON.Vec3();
        const vB = new CANNON.Vec3();
        c.bi.getVelocityAtWorldPoint(c.bi.position.vadd(c.ri), vA);
        c.bj.getVelocityAtWorldPoint(c.bj.position.vadd(c.rj), vB);
        impact = Math.max(impact, Math.abs(vA.vsub(vB).dot(c.ni)));
      }
    }
    for (const fn of this._collisionListeners) fn(bodyA, bodyB, impact);
  }

  /** Subscribe to collisions. Returns an unsubscribe function. */
  onCollision(fn) {
    this._collisionListeners.add(fn);
    return () => this._collisionListeners.delete(fn);
  }

  addBody(body) { this.world.addBody(body); return body; }
  removeBody(body) { this.world.removeBody(body); }

  step(dt) {
    this.world.step(dt);
  }

  dispose() {
    this.world.removeEventListener('beginContact', this._onBeginContact);
    this._collisionListeners.clear();
    while (this.world.bodies.length) this.world.removeBody(this.world.bodies[0]);
  }
}
