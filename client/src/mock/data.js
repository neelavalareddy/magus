export const connections = [
    { id: 'u1', name: 'Alice Chen', avatar: 'AC', color: '#3B82F6' },
    { id: 'u2', name: 'Bob Smith', avatar: 'BS', color: '#10B981' },
    { id: 'u3', name: 'Carol Davis', avatar: 'CD', color: '#F59E0B' },
  ];
  
  export const groups = [
    { id: 'g1', name: 'Study Session', members: ['u1', 'u2'] },
    { id: 'g2', name: 'Project Team', members: ['u2', 'u3'] },
  ];
  
  export const generateMockEvents = (userIds) => {
    return userIds.map(id => ({
      userId: id,
      start: 10,
      end: 11,
      busy: true
    }));
  };
  